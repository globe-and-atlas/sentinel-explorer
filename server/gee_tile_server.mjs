import eeImport from '@google/earthengine';
import 'dotenv/config';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ee = eeImport.default || eeImport;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4177);
const MAP_CACHE_TTL_MS = Number(process.env.GEE_MAP_CACHE_TTL_MS || 45 * 60 * 1000);
const TILE_CACHE_TTL_MS = Number(process.env.GEE_TILE_CACHE_TTL_MS || 10 * 60 * 1000);
const TILE_CACHE_MAX = Number(process.env.GEE_TILE_CACHE_MAX || 768);
const TILE_FETCH_MAX_CONCURRENT = Number(process.env.GEE_TILE_MAX_CONCURRENT || 2);
const TILE_FETCH_RETRIES = Number(process.env.GEE_TILE_RETRIES || 4);
const TILE_FETCH_RETRY_MS = Number(process.env.GEE_TILE_RETRY_MS || 1200);
const SINGLE_DATE_LOOKBACK_DAYS = Number(process.env.GEE_SINGLE_DATE_LOOKBACK_DAYS || 30);
const SINGLE_DATE_FORWARD_DAYS = Number(process.env.GEE_SINGLE_DATE_FORWARD_DAYS || 15);
const S2_COLLECTION = process.env.GEE_S2_COLLECTION || 'COPERNICUS/S2_SR_HARMONIZED';
const S2_BANDS = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12'];
const PYTHON = process.env.PYTHON || process.env.PYTHON_BIN || 'python3';
const COG_CACHE_DIR = path.resolve(ROOT, process.env.COG_TILE_CACHE_DIR || '.tmp/cog_tile_cache');
const COG_RENDER_SCRIPT = path.resolve(ROOT, 'execution/render_cog_tile.py');
const COG_RENDER_VERSION = 'cog-render-2026-07-21-gate-diagnostics-v5';
const COG_STAC_URL = process.env.COG_STAC_URL || 'https://earth-search.aws.element84.com/v1';
const COG_STAC_COLLECTION = process.env.COG_STAC_COLLECTION || 'sentinel-2-l2a';
const COG_MAXCC = Number(process.env.COG_MAXCC || 90);
const COG_RENDER_TIMEOUT_MS = Number(process.env.COG_RENDER_TIMEOUT_MS || 120000);
const COG_TILE_SIZE = Number(process.env.COG_TILE_SIZE || 256);
const COG_ITEM_CACHE_DIR = path.resolve(ROOT, process.env.COG_ITEM_CACHE_DIR || '.tmp/cog_item_cache');
const COG_ITEM_CACHE_TTL_SECONDS = Number(process.env.COG_ITEM_CACHE_TTL_SECONDS || 7 * 24 * 60 * 60);
const COG_PREWARM_ON_START = process.env.COG_PREWARM_ON_START !== '0';
const COG_PREWARM_LIMIT = Number(process.env.COG_PREWARM_LIMIT || 4);
const COG_PREWARM_RADIUS = Number(process.env.COG_PREWARM_RADIUS || 0);
const COG_SUPPORTED_INDEXES = new Set([
    'tc', 'truecolor', 'true-color', 'swir_rgb',
    'awei', 'ndre', 'ndmi', 'ndwi', 'ndvi', 'savi', 'bsi', 'ndsi',
    'si', 'csi', 'hcai', 'hmri', 'ndoi', 'ksi', 'vssi',
    'pwi', 'hpwi', 'pwoi', 'lbi'
]);
const COG_DEMO_INDEXES = ['hpwi', 'lbi', 'pwoi', 'pwi'];
const COG_PREWARM_TARGETS = [
    // These experimental/SWIR lenses render on their native 20 m grid, one
    // XYZ level below the UI map zoom.
    { label: 'Lake Boehmer', lat: 31.226, lng: -102.729, zoom: 13, date: '2026-01-01', indexes: ['hpwi', 'lbi', 'pwoi', 'pwi'] },
    { label: 'Meister Ranch Geyser', lat: 31.3826, lng: -102.6171, zoom: 14, date: '2022-01-02', indexes: ['lbi'] },
    { label: 'Toyah Well Blowout', lat: 31.320, lng: -103.872, zoom: 14, date: '2024-10-02', indexes: ['hpwi', 'lbi'] },
    { label: 'Matador Desoto Spring Pond', lat: 32.07605, lng: -103.28241, zoom: 15, date: '2025-09-21', indexes: ['hpwi', 'lbi', 'pwoi'] }
];

let eeReadyPromise = null;
const dynamicMapCache = new Map();
const tileResponseCache = new Map();
const inFlightTileResponses = new Map();
const inFlightCogRenders = new Map();
const tileFetchQueue = [];
let activeTileFetches = 0;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function cacheSetLru(cache, key, value, maxEntries) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxEntries) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
    }
}

function stableSearch(searchParams) {
    return Array.from(searchParams.entries())
        .filter(([key]) => key !== 'key')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
}

function tileRequestKey(urlPath, searchParams) {
    const query = stableSearch(searchParams);
    return query ? `${urlPath}?${query}` : urlPath;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

async function withTileFetchSlot(fn) {
    if (activeTileFetches >= TILE_FETCH_MAX_CONCURRENT) {
        await new Promise(resolve => tileFetchQueue.push(resolve));
    }

    activeTileFetches++;
    try {
        return await fn();
    } finally {
        activeTileFetches--;
        const next = tileFetchQueue.shift();
        if (next) setImmediate(next);
    }
}

function retryDelay(resp, attempt) {
    const retryAfter = Number(resp.headers.get('retry-after') || 0);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return retryAfter * 1000;
    }
    return TILE_FETCH_RETRY_MS * Math.max(1, attempt + 1);
}

async function fetchGeeTileBytes(tileUrl) {
    return withTileFetchSlot(async () => {
        let lastTile = null;
        for (let attempt = 0; attempt <= TILE_FETCH_RETRIES; attempt++) {
            const tileResp = await fetch(tileUrl);
            const contentType = tileResp.headers.get('content-type') || 'image/png';
            const body = Buffer.from(await tileResp.arrayBuffer());
            lastTile = { status: tileResp.status, contentType, body };

            if (tileResp.status !== 429 || attempt === TILE_FETCH_RETRIES) {
                return lastTile;
            }

            await sleep(retryDelay(tileResp, attempt));
        }
        return lastTile;
    });
}

function contentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
    }[ext] || 'application/octet-stream';
}

function normalizePrivateKey(rawKey) {
    return rawKey.replace(/\\n/g, '\n');
}

function envSafe(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function mapNameFor(indexKey, appName) {
    const safeIndex = envSafe(indexKey);
    const safeApp = envSafe(appName);
    const candidates = [
        safeApp && safeIndex ? `GEE_MAP_NAME_${safeApp}_${safeIndex}` : '',
        safeIndex ? `GEE_MAP_NAME_${safeIndex}` : '',
        safeApp ? `GEE_MAP_NAME_${safeApp}` : '',
        'GEE_MAP_NAME'
    ].filter(Boolean);
    const envKey = candidates.find(key => process.env[key]);
    return envKey ? process.env[envKey] : '';
}

function readServiceAccount() {
    if (process.env.GEE_SERVICE_ACCOUNT_JSON) {
        return JSON.parse(process.env.GEE_SERVICE_ACCOUNT_JSON);
    }
    if (process.env.GEE_SERVICE_ACCOUNT_JSON_PATH) {
        return JSON.parse(fs.readFileSync(process.env.GEE_SERVICE_ACCOUNT_JSON_PATH, 'utf8'));
    }
    if (process.env.GEE_SERVICE_ACCOUNT_EMAIL && process.env.GEE_PRIVATE_KEY) {
        return {
            client_email: process.env.GEE_SERVICE_ACCOUNT_EMAIL,
            private_key: normalizePrivateKey(process.env.GEE_PRIVATE_KEY)
        };
    }
    throw new Error('Set GEE_SERVICE_ACCOUNT_JSON, GEE_SERVICE_ACCOUNT_JSON_PATH, or GEE_SERVICE_ACCOUNT_EMAIL + GEE_PRIVATE_KEY. Browser API keys alone cannot create Earth Engine maps.');
}

function ensureEarthEngine() {
    if (eeReadyPromise) return eeReadyPromise;

    eeReadyPromise = new Promise((resolve, reject) => {
        const project = process.env.GEE_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
        if (process.env.GEE_API_KEY) ee.data.setApiKey(process.env.GEE_API_KEY);
        if (project) ee.data.setProject(project);

        ee.data.authenticateViaPrivateKey(
            readServiceAccount(),
            () => {
                ee.initialize(
                    null,
                    null,
                    resolve,
                    reject,
                    null,
                    project || null
                );
            },
            reject
        );
    });

    return eeReadyPromise;
}

function parseTimeWindow(searchParams) {
    const time = searchParams.get('time');
    const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
    if (time && time.includes('/')) {
        const [start, end] = time.split('/');
        return { start, end };
    }
    const target = time || date;
    return {
        start: addDays(target, -SINGLE_DATE_LOOKBACK_DAYS),
        end: addDays(target, SINGLE_DATE_FORWARD_DAYS)
    };
}

function addDays(dateStr, days) {
    const date = new Date(`${dateStr}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function getS2Image(searchParams) {
    const { start, end } = parseTimeWindow(searchParams);
    const maxcc = Number(searchParams.get('maxcc') || 90);
    const endExclusive = addDays(end, 1);

    const collection = ee.ImageCollection(S2_COLLECTION)
        .filterDate(start, endExclusive)
        .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', maxcc))
        .map((image) => {
            const scl = image.select('SCL');
            const clearMask = scl.eq(4)
                .or(scl.eq(5))
                .or(scl.eq(6))
                .or(scl.eq(7));
            return image.updateMask(clearMask);
        });

    // A bare /10000 is correct HERE and only here: S2_SR_HARMONIZED already
    // shifts post-baseline-04.00 scenes back into the pre-04.00 DN range, so the
    // BOA_ADD_OFFSET is spent before we see the pixels. Do not copy this line
    // into a raw-DN path — execution/render_cog_tile.py reads unharmonized ESA
    // DN from Earth Search and must apply the offset itself.
    return collection
        .median()
        .select(['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'], S2_BANDS)
        .divide(10000);
}

function bandVars(image) {
    return Object.fromEntries(S2_BANDS.map(band => [band, image.select(band)]));
}

function score(image, expression) {
    return image.expression(expression, bandVars(image)).rename('score');
}

function visualScore(scoreImage, palette, threshold = 0.05, min = 0, max = 1) {
    const masked = scoreImage.updateMask(scoreImage.gte(threshold));
    return { image: masked, vis: { min, max, palette } };
}

function trueColor(image) {
    return {
        image,
        vis: { bands: ['B04', 'B03', 'B02'], min: 0.02, max: 0.35, gamma: 1.15 }
    };
}

function falseColor(image) {
    return {
        image,
        vis: { bands: ['B08', 'B04', 'B03'], min: 0.02, max: 0.45, gamma: 1.1 }
    };
}

function swirContext(image) {
    return {
        image,
        vis: { bands: ['B12', 'B11', 'B04'], min: 0.02, max: 0.42, gamma: 1.12 }
    };
}

function buildEhc(image) {
    const vars = bandVars(image);
    const red = image.expression('max(0, ((B02 - B12) / (B02 + B12 + 0.0001)) * 3)', vars).rename('red');
    const green = image.expression('max(0, (((B11 + B04) - (B08 + B02)) / ((B11 + B04) + (B08 + B02) + 0.0001)) * 2)', vars).rename('green');
    const blue = image.expression('max(0, ((B11 - B12) / (B11 + B12 + 0.0001)) * 4)', vars).rename('blue');
    const rgb = ee.Image.cat([red, green, blue]).clamp(0, 1);
    const intensity = rgb.reduce(ee.Reducer.max());
    return { image: rgb.updateMask(intensity.gte(0.08)), vis: { min: 0, max: 1, bands: ['red', 'green', 'blue'] } };
}

function buildIndexImage(indexKey, searchParams) {
    const key = String(indexKey || 'tc').toLowerCase();
    const image = getS2Image(searchParams);
    const sensitivity = Number(searchParams.get('sensitivity') || 0) / 100;
    const basin = String(searchParams.get('basin') || 'permian').toLowerCase();
    const calibration = basin === 'standard'
        ? { bsiMask: -0.1, salinity: 0.05, surface: 0.15, ratio: 1.5 }
        : { bsiMask: -0.3, salinity: 0.10, surface: 0.30, ratio: 2.0 };
    const obecDualSwirThreshold = Math.max(0.04, 0.06 - sensitivity * 0.03);

    if (key === 'tc' || key === 'truecolor' || key === 'true-color') return trueColor(image);
    if (key === 'fc' || key === 'falsecolor' || key === 'false-color') return falseColor(image);
    if (key === 'swir_rgb') return swirContext(image);
    if (key === 'ehc') return buildEhc(image);
    if (searchParams.get('app') === 'atlas') return trueColor(image);

    const palettes = {
        pwi: ['00ffff', 'ff00ff', 'ccff00'],
        hpwi: ['4b0082', 'e74c3c', 'f1c40f'],
        pwoi: ['00102a', '00d2ff', 'ff00ff', '8c00ff'],
        lbi: ['0055ff', '00d2ff', 'ffffff'],
        bpi: ['444444', '00ffff', 'ffff00'],
        fbc: ['8b2500', 'd4581a', 'ffb347'],
        vsi: ['ffff00', 'ff8800', 'ff0000'],
        mvpi: ['f57814', 'ffb400']
    };

    if (key === 'ndvi') {
        return visualScore(
            image.normalizedDifference(['B08', 'B04']).rename('score'),
            ['6b3f1d', 'f2e394', '1a9850'],
            -1,
            -0.3,
            0.8
        );
    }
    if (key === 'ndwi') {
        return visualScore(
            image.normalizedDifference(['B03', 'B11']).rename('score'),
            ['2b1a12', '00d2ff', 'ffffff'],
            -1,
            -0.6,
            0.6
        );
    }
    if (key === 'ndmi') {
        return visualScore(
            image.normalizedDifference(['B8A', 'B11']).rename('score'),
            ['3b1f0f', '00a6a6', 'f7f7f7'],
            -1,
            -0.5,
            0.7
        );
    }
    if (key === 'savi') {
        return visualScore(
            score(image, '((B08 - B04) / (B08 + B04 + 0.5)) * 1.5'),
            ['6b3f1d', 'f2e394', '1a9850'],
            -1,
            -0.3,
            0.8
        );
    }
    if (key === 'bsi') {
        return visualScore(
            score(image, '((B11 + B04) - (B08 + B02)) / ((B11 + B04) + (B08 + B02) + 0.0001)'),
            ['448833', 'd2b43c', 'a07832'],
            -1,
            0,
            0.4
        );
    }
    if (key === 'ndsi') {
        return visualScore(
            image.normalizedDifference(['B11', 'B12']).rename('score'),
            ['0a3c64', 'f0501e', 'e61414'],
            0,
            0,
            0.5
        );
    }
    if (key === 'awei') {
        return visualScore(
            score(image, 'B02 + 2.5 * B03 - 1.5 * (B08 + B11) - 0.25 * B12'),
            ['302412', 'c19a48', '2397b5', '084380'],
            0,
            0,
            0.2
        );
    }
    if (key === 'ndre') {
        return visualScore(
            image.normalizedDifference(['B8A', 'B05']).rename('score'),
            ['693820', 'cda748', '5c9747', '105b34'],
            -1,
            -0.2,
            0.7
        );
    }

    const expressions = {
        pwi: `
            ((((B11 + B04) - (B08 + B02)) / ((B11 + B04) + (B08 + B02) + 0.0001)) <= ${calibration.bsiMask}
                ? 0
                : min(1, pow(
                    max(0, ((B11 - B12) / (B11 + B12 + 0.0001)) - ${calibration.salinity}) *
                    max(0, (((B11 - B04) / (B11 + B04 + 0.0001)) - ${calibration.surface}) * 2) *
                    max(0, ((B12 / (B03 + 0.0001)) - ${calibration.ratio}) * 2) *
                    20,
                    3
                )))
        `,
        hpwi: `
            min(1,
                min(1,
                    max(0, ((B02 - B12) / (B02 + B12 + 0.0001))) +
                    max(0, ((B11 - B12) / (B11 + B12 + 0.0001)) - ${obecDualSwirThreshold}) * 0.8
                ) *
                max(0, min(1, ((((B03 - B11) / (B03 + B11 + 0.0001)) + 0.3) / 0.6))) *
                6
            )
        `,
        pwoi: `
            max(
                (((((B03 - B11) / (B03 + B11 + 0.0001)) + 0.3) / 0.6) > 0.58 &&
                  (((B11 - B12) / (B11 + B12 + 0.0001)) - 0.035) > 0)
                    ? min(1,
                        min(1, max(0, ((((B03 - B11) / (B03 + B11 + 0.0001)) + 0.3) / 0.6))) * 0.42 +
                        min(1, max(0, (((B11 - B12) / (B11 + B12 + 0.0001)) - 0.035) / 0.16)) * 0.58
                      )
                    : 0),
                ((((B03 - B11) / (B03 + B11 + 0.0001)) < -0.42 &&
                  ((B11 - B12) / (B11 + B12 + 0.0001)) > 0.15 &&
                  (((B11 + B04) - (B08 + B02)) / ((B11 + B04) + (B08 + B02) + 0.0001)) > 0.52)
                    ? min(1, max(0, ((((B11 - B12) / (B11 + B12 + 0.0001)) - 0.15) / 0.16) * 0.45 + 0.55))
                    : 0)
            )
        `,
        lbi: `
            min(1,
                (((((B11 + B04) - (B08 + B02)) / ((B11 + B04) + (B08 + B02) + 0.0001)) <= -0.25 &&
                   ((B03 - B11) / (B03 + B11 + 0.0001)) <= 0.30) ? 0 : 1) *
                max(0, ((B11 - B12) / (B11 + B12 + 0.0001)) - 0.02) *
                max(0, ((B03 - B11) / (B03 + B11 + 0.0001)) + 0.40) *
                max(0, 0.45 - ((B08 - B04) / (B08 + B04 + 0.0001))) *
                ((((B03 - B11) / (B03 + B11 + 0.0001)) > 0.30)
                    ? 1
                    : max(0, (((B11 + B04) - (B08 + B02)) / ((B11 + B04) + (B08 + B02) + 0.0001)) + 0.20)) *
                20
            )
        `,
        bpi: `
            min(1,
                max(0, (((B11 + B04) - (B08 + B02)) / ((B11 + B04) + (B08 + B02) + 0.0001)) + 0.15) *
                max(0, ((B11 - B12) / (B11 + B12 + 0.0001)) - 0.03) *
                max(0, ((B11 - B04) / (B11 + B04 + 0.0001)) - 0.15) *
                30
            )
        `,
        fbc: `
            min(1,
                pow(
                    max(0, ((B04 / (B02 + 0.0001)) - 1.4)) *
                    max(0, ((B11 - B12) / (B11 + B12 + 0.0001)) - 0.04) *
                    max(0, 1 - max(0, ((B08 - B04) / (B08 + B04 + 0.0001)))),
                    1.4
                ) * 150
            )
        `,
        vsi: `
            min(1,
                max(0, ((B11 - B12) / (B11 + B12 + 0.0001))) *
                max(0, 0.4 - ((B07 - B05) / (B07 + B05 + 0.0001))) *
                max(0, (B11 / (B8A + 0.0001)) - 1.0) *
                10
            )
        `,
        mvpi: `
            min(1,
                (B03 > B11 ? 0 : 1) *
                (((B08 - B04) / (B08 + B04 + 0.0001)) > 0.15 ? 0 : 1) *
                max(0, (((B11 + B12) / 2) - 0.20) * 2) *
                max(0, ((B11 / (B12 + 0.0001)) - 1.15) * 4) *
                3
            )
        `
    };

    const expression = expressions[key];
    if (!expression) return trueColor(image);

    const thresholds = { pwi: 0.05, hpwi: 0.08, pwoi: 0.60, lbi: 0.08, bpi: 0.04, fbc: 0.06, vsi: 0.05, mvpi: 0.05 };
    return visualScore(score(image, expression), palettes[key], thresholds[key] ?? 0.05);
}

function getMapId(eeImage, vis) {
    return new Promise((resolve, reject) => {
        eeImage.getMapId(vis || {}, (mapId, err) => {
            if (err) reject(new Error(String(err)));
            else resolve(mapId);
        });
    });
}

function cacheKey(searchParams) {
    const keys = ['app', 'index', 'time', 'date', 'maxcc', 'basin', 'visualFilter', 'sensitivity'];
    return keys.map(key => `${key}=${searchParams.get(key) || ''}`).join('&');
}

async function getDynamicMap(searchParams) {
    await ensureEarthEngine();
    const key = cacheKey(searchParams);
    const cached = dynamicMapCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.mapId;

    const indexKey = searchParams.get('index') || 'tc';
    const { image, vis } = buildIndexImage(indexKey, searchParams);
    const mapId = await getMapId(image, vis);
    dynamicMapCache.set(key, { mapId, expiresAt: Date.now() + MAP_CACHE_TTL_MS });
    return mapId;
}

async function tileUrlFromPrecreatedMap(mapName, x, y, z) {
    await ensureEarthEngine();
    const mapId = { mapid: mapName };
    return ee.data.getTileUrl(mapId, Number(x), Number(y), Number(z));
}

async function handleGeeTile(req, res, urlPath, searchParams) {
    const match = urlPath.match(/^\/api\/gee\/tiles\/(\d+)\/(\d+)\/(\d+)$/);
    if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid Earth Engine tile URL.' }));
        return;
    }

    const [, z, x, y] = match;
    const indexKey = searchParams.get('index') || 'default';
    const appName = searchParams.get('app') || 'limn';
    const requestKey = tileRequestKey(urlPath, searchParams);
    const cachedTile = tileResponseCache.get(requestKey);

    if (cachedTile && cachedTile.expiresAt > Date.now()) {
        res.writeHead(cachedTile.status, {
            'Content-Type': cachedTile.contentType,
            'Cache-Control': 'public, max-age=300',
            'X-Limn-Tile-Cache': 'hit'
        });
        res.end(cachedTile.body);
        return;
    }

    try {
        if (!inFlightTileResponses.has(requestKey)) {
            inFlightTileResponses.set(requestKey, (async () => {
                const precreatedMapName = mapNameFor(indexKey, appName);
                const tileUrl = precreatedMapName
                    ? await tileUrlFromPrecreatedMap(precreatedMapName, x, y, z)
                    : ee.data.getTileUrl(await getDynamicMap(searchParams), Number(x), Number(y), Number(z));
                const tile = await fetchGeeTileBytes(tileUrl);

                if (tile.status >= 200 && tile.status < 300) {
                    cacheSetLru(
                        tileResponseCache,
                        requestKey,
                        { ...tile, expiresAt: Date.now() + TILE_CACHE_TTL_MS },
                        TILE_CACHE_MAX
                    );
                }

                return tile;
            })().finally(() => {
                inFlightTileResponses.delete(requestKey);
            }));
        }

        const tile = await inFlightTileResponses.get(requestKey);
        res.writeHead(tile.status, {
            'Content-Type': tile.contentType,
            'Cache-Control': tile.status >= 200 && tile.status < 300 ? 'public, max-age=300' : 'no-store',
            'X-Limn-Tile-Cache': cachedTile ? 'hit' : 'miss'
        });
        res.end(tile.body);
    } catch (err) {
        const missingAuth = /GEE_SERVICE_ACCOUNT|Browser API keys alone|authentication/i.test(err.message);
        res.writeHead(missingAuth ? 501 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: missingAuth ? 'Earth Engine credentials are not configured.' : 'Earth Engine tile proxy failed.',
            detail: err.message
        }));
    }
}

function renderCogTile(z, x, y, searchParams, outputPath, signal = undefined) {
    return new Promise((resolve, reject) => {
        const args = [
            COG_RENDER_SCRIPT,
            '--z', String(z),
            '--x', String(x),
            '--y', String(y),
            '--index', searchParams.get('index') || 'tc',
            '--time', searchParams.get('time') || searchParams.get('date') || new Date().toISOString().slice(0, 10),
            '--size', String(COG_TILE_SIZE),
            '--maxcc', String(Number(searchParams.get('maxcc') || COG_MAXCC)),
            '--sensitivity', String(Number(searchParams.get('sensitivity') || 0)),
            '--basin', String(searchParams.get('basin') || 'permian'),
            '--visual-filter', String(Number(searchParams.get('visualFilter') || 0)),
            '--stac-url', COG_STAC_URL,
            '--collection', COG_STAC_COLLECTION,
            '--item-cache-dir', COG_ITEM_CACHE_DIR,
            '--item-cache-ttl', String(COG_ITEM_CACHE_TTL_SECONDS),
            '--output', outputPath
        ];

        execFile(PYTHON, args, {
            cwd: ROOT,
            timeout: COG_RENDER_TIMEOUT_MS,
            maxBuffer: 1024 * 1024,
            signal,
            env: {
                ...process.env,
                COG_STAC_URL,
                COG_STAC_COLLECTION,
                GDAL_DISABLE_READDIR_ON_OPEN: process.env.GDAL_DISABLE_READDIR_ON_OPEN || 'EMPTY_DIR',
                CPL_VSIL_CURL_ALLOWED_EXTENSIONS: process.env.CPL_VSIL_CURL_ALLOWED_EXTENSIONS || '.tif,.TIF,.tiff,.TIFF',
                AWS_NO_SIGN_REQUEST: process.env.AWS_NO_SIGN_REQUEST || 'YES'
            }
        }, (error, stdout, stderr) => {
            if (error) {
                const detail = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || error.message);
                reject(new Error(detail.trim() || error.message));
                return;
            }
            resolve(Buffer.isBuffer(stderr) ? stderr.toString('utf8').trim() : String(stderr || '').trim());
        });
    });
}

async function handleCogTile(req, res, urlPath, searchParams) {
    const match = urlPath.match(/^\/api\/cog\/tiles\/(\d+)\/(\d+)\/(\d+)$/);
    if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid COG tile URL.' }));
        return;
    }

    const [, z, x, y] = match;
    const indexKey = String(searchParams.get('index') || 'tc').toLowerCase();
    if (!COG_SUPPORTED_INDEXES.has(indexKey)) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
            error: 'Unsupported COG index.',
            detail: `${indexKey} is not implemented in the Sentinel-2 COG renderer.`
        }));
        return;
    }

    const requestKey = `${tileRequestKey(urlPath, searchParams)}&renderer=${COG_RENDER_VERSION}`;
    const cachePath = path.join(COG_CACHE_DIR, `${sha256(requestKey)}.png`);

    if (fs.existsSync(cachePath)) {
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=300',
            'X-Limn-Tile-Cache': 'disk-hit',
            'X-Limn-Tile-Provider': 'cog'
        });
        fs.createReadStream(cachePath).pipe(res);
        return;
    }

    try {
        fs.mkdirSync(COG_CACHE_DIR, { recursive: true });
        if (!inFlightCogRenders.has(requestKey)) {
            const controller = new AbortController();
            const entry = { controller, clients: 0, settled: false, promise: null };
            entry.promise = (async () => {
                const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
                try {
                    const metadata = await renderCogTile(z, x, y, searchParams, tmpPath, controller.signal);
                    fs.renameSync(tmpPath, cachePath);
                    return { cachePath, metadata };
                } catch (error) {
                    fs.rmSync(tmpPath, { force: true });
                    throw error;
                }
            })().finally(() => {
                entry.settled = true;
                inFlightCogRenders.delete(requestKey);
            });
            inFlightCogRenders.set(requestKey, entry);
        }

        const entry = inFlightCogRenders.get(requestKey);
        entry.clients++;
        let detached = false;
        const detachClient = () => {
            if (detached) return;
            detached = true;
            entry.clients = Math.max(0, entry.clients - 1);
            if (entry.clients === 0 && !entry.settled) entry.controller.abort();
        };
        const handleAborted = () => detachClient();
        const handlePrematureClose = () => {
            if (!res.writableEnded) detachClient();
        };
        req.once('aborted', handleAborted);
        res.once('close', handlePrematureClose);

        let tile;
        try {
            tile = await entry.promise;
        } finally {
            req.off('aborted', handleAborted);
            res.off('close', handlePrematureClose);
            detachClient();
        }
        if (res.destroyed) return;
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=300',
            'X-Limn-Tile-Cache': 'miss',
            'X-Limn-Tile-Provider': 'cog',
            'X-Limn-COG-Metadata': encodeURIComponent(tile.metadata || '')
        });
        fs.createReadStream(tile.cachePath).pipe(res);
    } catch (err) {
        if (res.destroyed || err?.name === 'AbortError' || err?.code === 'ABORT_ERR') return;
        res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
            error: 'COG tile render failed.',
            detail: err.message
        }));
    }
}

function lonLatToTile(lng, lat, zoom) {
    const z = Number(zoom);
    const latRad = lat * Math.PI / 180;
    const n = 2 ** z;
    const x = Math.floor((lng + 180) / 360 * n);
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { z, x, y };
}

function parseCsv(value, fallback = []) {
    if (!value) return fallback;
    return String(value)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function clampTile(value, zoom) {
    const max = (2 ** Number(zoom)) - 1;
    return Math.max(0, Math.min(max, value));
}

async function prewarmCogTile(z, x, y, params) {
    const urlPath = `/api/cog/tiles/${z}/${x}/${y}`;
    const requestKey = `${tileRequestKey(urlPath, params)}&renderer=${COG_RENDER_VERSION}`;
    const cachePath = path.join(COG_CACHE_DIR, `${sha256(requestKey)}.png`);
    if (fs.existsSync(cachePath)) return { status: 'cached', z, x, y, index: params.get('index') };

    fs.mkdirSync(COG_CACHE_DIR, { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await renderCogTile(String(z), String(x), String(y), params, tmpPath);
    fs.renameSync(tmpPath, cachePath);
    return { status: 'rendered', z, x, y, index: params.get('index') };
}

function targetFromSearch(searchParams) {
    if (!searchParams.has('lat') || !searchParams.has('lng')) return null;
    const lat = Number(searchParams.get('lat'));
    const lng = Number(searchParams.get('lng'));
    const zoom = Number(searchParams.get('zoom') || searchParams.get('z') || 14);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
        label: searchParams.get('label') || 'ad hoc',
        lat,
        lng,
        zoom,
        date: searchParams.get('time') || searchParams.get('date') || new Date().toISOString().slice(0, 10),
        indexes: parseCsv(searchParams.get('indexes'), COG_DEMO_INDEXES)
    };
}

async function prewarmCogTargets(searchParams) {
    const explicitTarget = targetFromSearch(searchParams);
    const limit = Math.max(1, Number(searchParams.get('limit') || COG_PREWARM_LIMIT));
    const radius = Math.max(0, Number(searchParams.get('radius') || COG_PREWARM_RADIUS));
    const targets = explicitTarget ? [explicitTarget] : COG_PREWARM_TARGETS.slice(0, limit);
    const results = [];

    for (const target of targets) {
        const center = lonLatToTile(target.lng, target.lat, target.zoom);
        const indexes = parseCsv(searchParams.get('indexes'), target.indexes || COG_DEMO_INDEXES)
            .map(index => index.toLowerCase())
            .filter(index => COG_SUPPORTED_INDEXES.has(index));

        for (const index of indexes) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    const params = new URLSearchParams({
                        index,
                        time: target.date,
                        diff: '0',
                        cumulative: '0',
                        basin: 'permian',
                        visualFilter: '0',
                        sensitivity: '0'
                    });
                    try {
                        const result = await prewarmCogTile(
                            center.z,
                            clampTile(center.x + dx, center.z),
                            clampTile(center.y + dy, center.z),
                            params
                        );
                        results.push({ ...result, label: target.label });
                    } catch (err) {
                        results.push({
                            status: 'error',
                            label: target.label,
                            index,
                            detail: err.message
                        });
                    }
                }
            }
        }
    }

    return results;
}

async function handleCogPrewarm(req, res, searchParams) {
    try {
        const results = await prewarmCogTargets(searchParams);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
            ok: results.every(result => result.status !== 'error'),
            count: results.length,
            rendered: results.filter(result => result.status === 'rendered').length,
            cached: results.filter(result => result.status === 'cached').length,
            errors: results.filter(result => result.status === 'error'),
            results
        }));
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'COG prewarm failed.', detail: err.message }));
    }
}

function serveStatic(urlPath, res) {
    const relativePath = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    const filePath = path.normalize(path.join(ROOT, relativePath));
    if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    const type = contentType(filePath);
    const shouldRevalidate = /\.(html?|m?js|css)$/i.test(filePath);
    res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': shouldRevalidate ? 'no-store' : 'public, max-age=300'
    });
    fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const urlPath = decodeURIComponent(requestUrl.pathname);

    if (urlPath.startsWith('/api/gee/tiles/')) {
        await handleGeeTile(req, res, urlPath, requestUrl.searchParams);
        return;
    }

    if (urlPath === '/api/cog/prewarm') {
        await handleCogPrewarm(req, res, requestUrl.searchParams);
        return;
    }

    if (urlPath.startsWith('/api/cog/tiles/')) {
        await handleCogTile(req, res, urlPath, requestUrl.searchParams);
        return;
    }

    serveStatic(urlPath, res);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Limn tile server listening at http://127.0.0.1:${PORT}`);
    if (COG_PREWARM_ON_START) {
        setTimeout(() => {
            prewarmCogTargets(new URLSearchParams({ limit: String(COG_PREWARM_LIMIT), radius: String(COG_PREWARM_RADIUS) }))
                .then(results => {
                    const rendered = results.filter(result => result.status === 'rendered').length;
                    const cached = results.filter(result => result.status === 'cached').length;
                    const errors = results.filter(result => result.status === 'error').length;
                    console.log(`COG prewarm complete: ${rendered} rendered, ${cached} cached, ${errors} errors`);
                })
                .catch(err => {
                    console.warn(`COG prewarm failed: ${err.message}`);
                });
        }, 750);
    }
});
