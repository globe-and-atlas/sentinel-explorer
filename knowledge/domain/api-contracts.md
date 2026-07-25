# API Contracts — Sentinel Explorer

## Sentinel-2 COG Tile Provider

**Produced Water default provider**: `IMAGE_PROVIDER: "cog"`

**Browser tile endpoint contract**: `/api/cog/tiles/{z}/{x}/{y}`

Query params sent by `getCOGLayer()`:
- `index`: active Limn index key, currently `tc`, `pwi`, `hpwi`, `pwoi`, or `lbi`
- `time`: `YYYY-MM-DD` or range `YYYY-MM-DD/YYYY-MM-DD`
- `diff`: accepted for provider parity, but COG mode disables the Diff UI because temporal differencing is not implemented in the COG renderer
- `cumulative`: accepted for provider parity, but COG mode disables the Cumulative UI because temporal accumulation is not implemented in the COG renderer
- `basin`: calibration key, usually `permian`
- `visualFilter`: passed for provider parity; currently ignored by the first COG renderer
- `sensitivity`: passed for provider parity; currently ignored by the first COG renderer

**Local server**: `npm run start:gee` also serves `/api/cog/tiles/{z}/{x}/{y}`. The COG route delegates to `execution/render_cog_tile.py`, which queries public Element84 Earth Search STAC (`sentinel-2-l2a`), reads only the requested tile window from public Sentinel-2 L2A COG band assets, reprojects via Rasterio `WarpedVRT`, computes Limn index RGBA, and writes a PNG. The server caches rendered PNG tiles under `.tmp/cog_tile_cache/`, with a renderer-version key so presentation/math changes do not reuse stale PNGs.

**COG prewarm endpoint**: `/api/cog/prewarm` renders default demo bookmark/index tiles into `.tmp/cog_tile_cache/`. Optional query params:
- `limit`: number of default demo targets to prewarm
- `radius`: tile radius around each target tile
- `lat`, `lng`, `zoom`, `date`, `indexes`: ad hoc target override

The local server also runs a small background prewarm on startup unless `COG_PREWARM_ON_START=0`.

**COG renderer dependencies**: local Python runtime with `rasterio`, `pystac_client`, `numpy`, `Pillow`, and `pyproj`.

**COG scope**: first implementation supports Produced Water true color plus PWCI (`pwi`), OBEC (`hpwi`), ASAI (`pwoi`), and LBI (`lbi`). Unsupported index keys return HTTP 400 and are disabled or hidden in COG-mode UI. Atlas normalizes a global `IMAGE_PROVIDER: "cog"` to GEE unless `ATLAS_IMAGE_PROVIDER` is explicitly set, because Atlas formulas are not yet ported to the COG renderer.

**COG visual contract**: analytical COG layers render as sparse semi-transparent overlays over the basemap. They are not intended to be full-scene false-color replacements. True color remains nearly opaque for context.

Optional server env:
- `COG_TILE_CACHE_DIR`
- `COG_ITEM_CACHE_DIR`
- `COG_ITEM_CACHE_TTL_SECONDS`
- `COG_PREWARM_ON_START`
- `COG_PREWARM_LIMIT`
- `COG_PREWARM_RADIUS`
- `COG_STAC_URL`
- `COG_STAC_COLLECTION`
- `COG_MAXCC`
- `COG_RENDER_TIMEOUT_MS`
- `COG_TILE_SIZE`
- `PYTHON` or `PYTHON_BIN`

### Reflectance convention differs by provider — this is a correctness contract, not a detail

ESA Sentinel-2 processing baseline 04.00 (operational **2022-01-25**) introduced
`BOA_ADD_OFFSET = -1000` for L2A. Physical reflectance is therefore:

```
rho = (DN + BOA_ADD_OFFSET) / QUANTIFICATION_VALUE   # = (DN - 1000) / 10000  for baseline >= 04.00
rho = DN / 10000                                     # for baseline < 04.00
```

The three providers do **not** agree on who applies this:

| Provider | Serves | Who applies the offset | Correct client conversion |
|---|---|---|---|
| Earth Search COG (`sentinel-2-l2a`) | raw ESA DN | **nobody — the client must** | `(DN + offset) / 10000` |
| Sentinel Hub WMS / Processing API | harmonized | Sentinel Hub (`harmonizeValues` defaults to **true**) | values are already reflectance |
| Google Earth Engine (`COPERNICUS/S2_SR_HARMONIZED`) | harmonized by Google | Google | `DN / 10000` |

Consequences to keep in mind:

- A bare `DN / 10000` on the COG path reads **0.1 reflectance high** for any
  post-2022-01-25 scene. This is not a rounding concern — it is larger than most
  index thresholds in the catalog.
- An additive offset does **not** cancel in `(a - b) / (a + b)`. Normalized
  indices are biased toward zero, so "it's just a constant shift, ratios are safe"
  is false. NDVI from DN 3000/1500: 0.33 uncorrected vs 0.60 corrected.
- Prefer `earthsearch:boa_offset_applied` over the baseline string when present.
  If the archive already applied the offset, applying it again double-corrects.
- Absolute reflectance thresholds tuned on one provider do not transfer to
  another across the 2022-01-25 boundary without this correction.

Implemented in `execution/render_cog_tile.py` (`resolve_boa_offset`,
`item_boa_offset`); guarded by `tests/test_cog_boa_offset.py`.


## Google Earth Engine Tile Provider

**Fallback provider**: `IMAGE_PROVIDER: "gee"`

**Browser tile endpoint contract**: `/api/gee/tiles/{z}/{x}/{y}`

Query params sent by `getGEELayer()`:
- `app`: optional app namespace; `limn` for Produced Water, `atlas` for Limn Atlas
- `index`: active Limn index key, e.g. `hpwi`, `pwoi`, `lbi`
- `time`: `YYYY-MM-DD` or range `YYYY-MM-DD/YYYY-MM-DD`
- `diff`: `1` for change/diff mode, otherwise `0`
- `cumulative`: `1` for cumulative compare mode, otherwise `0`
- `basin`: calibration key, usually `permian`
- `visualFilter`: current visual cleanup slider value
- `sensitivity`: current sensitivity slider value
- `key`: optional browser API key if the backend expects it

**Auth boundary**: Earth Engine service-account credentials, private keys, OAuth refresh tokens, and project credentials must stay on the backend. The static browser app must not embed them. The backend should translate the Limn index/time params into an authenticated Earth Engine map request and stream or redirect the final XYZ tile image.

**Local server**: `npm run start:gee` serves the static app and dynamically creates Earth Engine maps for `/api/gee/tiles/{z}/{x}/{y}`. It loads `.env` through `dotenv`, authenticates with a service account, builds a Sentinel-2 SR Harmonized median mosaic for the requested date window, creates a short-lived Earth Engine map ID, caches that map ID for `GEE_MAP_CACHE_TTL_MS`, and proxies tile bytes back to Leaflet.

**Static cache contract**: Local GEE launcher runs are active-development surfaces. The server must send `Cache-Control: no-store` for `.html`, `.js`, `.mjs`, and `.css` so Chrome does not keep stale versioned module imports after tile-loader or UI fixes.

**Tile-rate contract**: Browser Leaflet grids can request many XYZ tiles at once. The GEE server must not pass that burst straight through to Earth Engine. It queues outbound tile byte fetches (`GEE_TILE_MAX_CONCURRENT`, default 2), retries upstream HTTP 429 responses (`GEE_TILE_RETRIES`, default 4), deduplicates simultaneous identical tile requests, and caches successful tile bytes (`GEE_TILE_CACHE_TTL_MS`, default 10 minutes). Produced Water and Atlas GEE layers must use fetch-based tile loaders with their own small queues and 429 retry/backoff instead of raw `<img>` tile loading.

**Single-date imagery contract**: Produced Water GEE tile requests may pass a single nominal date from the UI, but the server must expand it before querying Sentinel-2. Exact-day S2 filters often produce empty transparent tiles because no clear scene exists on that precise date. Defaults are `GEE_SINGLE_DATE_LOOKBACK_DAYS=30`, `GEE_SINGLE_DATE_FORWARD_DAYS=15`, and `maxcc=90` unless overridden.

**Render-quality contract**: GEE tiles are requested with high-DPI/retina tile behavior in both Produced Water and Atlas so desktop retina displays receive higher zoom tiles and scale them down. This improves presentation sharpness but does not change the physical information content: produced-water composites that depend on Sentinel-2 SWIR bands (`B11`, `B12`) remain limited by the native 20 m SWIR resolution. Do not force Earth Engine projection/resampling in the analytical mask path unless a follow-up test proves masks remain nonblank for OBEC, ASAI, LBI, and PWCI; projection forcing can collapse mask coverage.

Required server env:
- `GEE_PROJECT`
- `GEE_SERVICE_ACCOUNT_JSON_PATH` pointing to a service-account JSON outside the repo, or `GEE_SERVICE_ACCOUNT_EMAIL` + `GEE_PRIVATE_KEY`

Optional server env:
- `PORT`
- `GEE_API_KEY` (not a substitute for service-account auth)
- `GEE_MAP_CACHE_TTL_MS`
- `GEE_TILE_CACHE_TTL_MS`
- `GEE_TILE_CACHE_MAX`
- `GEE_TILE_MAX_CONCURRENT`
- `GEE_TILE_RETRIES`
- `GEE_TILE_RETRY_MS`
- `GEE_SINGLE_DATE_LOOKBACK_DAYS`
- `GEE_SINGLE_DATE_FORWARD_DAYS`
- `GEE_S2_COLLECTION`

Dynamic Produced Water indices currently translated server-side:
- `pwi` / PWCI
- `hpwi` / OBEC
- `pwoi` / ASAI
- `ehc`
- `lbi`
- `bpi`
- `fbc`
- `vsi`
- `mvpi`
- standard `tc`, `fc`, `ndvi`, `ndwi`, `ndmi`

Atlas sends `app=atlas` and its index key/acronym in tile query params. Atlas currently renders Earth Engine Sentinel-2 true-color context dynamically by default, keeping the app off Sentinel Hub while Atlas-specific formulas are translated incrementally. App-scoped pre-created map overrides such as `GEE_MAP_NAME_ATLAS` or `GEE_MAP_NAME_ATLAS_BH_DFSI` are still supported for custom Atlas maps. Atlas Sentinel Hub WMS is retained only when `IMAGE_PROVIDER` or `ATLAS_IMAGE_PROVIDER` is explicitly set to `sentinelhub`.

Atlas also has a top-right Sentinel WMS switch. Global `IMAGE_PROVIDER: "cog"` is normalized to Atlas GEE because Atlas COG formulas are not ported. The Atlas switch applies a session-only provider override to `sentinelhub`, arms live WMS tiles, and restores the default provider when switched off. Optional Atlas-specific guard settings are `ATLAS_SENTINEL_CREDIT_GUARD`, `ATLAS_SENTINEL_LIVE_TILES`, and `ATLAS_SENTINEL_MIN_ZOOM`; when omitted, Atlas uses the shared Sentinel guard settings.

Atlas Sentinel WMS source selection is separate from the Sentinel on/off switch. `ATLAS_WMS_SOURCE: "configured"` uses `SH_WMS_URL`, `ATLAS_WMS_URL`, `SH_INSTANCE_ID`, `SENTINEL_HUB_INSTANCE_ID`, or `WMS_INSTANCE_ID` from `config-v1.js`. `ATLAS_WMS_SOURCE: "viewer"` uses optional overrides `ATLAS_VIEWER_WMS_URL`, `SENTINEL_VIEWER_WMS_URL`, `ATLAS_VIEWER_INSTANCE_ID`, or `SENTINEL_VIEWER_INSTANCE_ID`, then falls back to verified alternate WMS configuration id `83a6b821-c0ad-43b1-848f-06f7b6b528a7`. These values must be real Sentinel Hub OGC WMS endpoints or OGC WMS configuration instance ids; Copernicus Browser/Viewer ids that start with `sh-` are not accepted by the OGC WMS endpoint. The Atlas HUD can switch sources per session. Changing sources does not arm Sentinel by itself; WMS requests are still gated by the live-tile switch, minimum zoom, and cooldown logic.

**Sentinel Hub fallback**: Sentinel Hub fallback is locked off unless both `ALLOW_SENTINEL_FALLBACK: true` and `IMAGE_PROVIDER: "sentinelhub"` are set. This prevents a secret-bearing local `config-v1.js` from accidentally overriding normal browsing back to Sentinel Hub while the account is out of credits. Default GEE mode still skips the mini GIF inset, AOI history scan, and report generation, since those secondary flows use Sentinel Hub/CDSE Statistics/Catalog APIs for actual analysis. **Acquisition probing is the exception (as of 2026-07-23)**: `probeAcquisitions()` in `app.js` no longer gates on `isGeeProviderActive()`, because CDSE STAC catalog lookups (used to filter the date selector to real Sentinel dates, see `[[architecture.md]]`) only need CDSE OAuth credentials and are unrelated to which provider serves map tiles. It runs under the default COG/GEE provider too.

**Sentinel Hub credit guard**: When Sentinel Hub fallback is active, WMS tiles are still blocked unless `SENTINEL_CREDIT_GUARD` is disabled or live tiles are armed. Defaults are `SENTINEL_CREDIT_GUARD: true`, `SENTINEL_LIVE_TILES: false`, and `SENTINEL_MIN_ZOOM: 14`. The top-right map toolbar exposes a Sentinel switch and minimum zoom slider. Off keeps the default COG/GEE provider. On applies a session-only Sentinel Hub provider override and arms live WMS tiles. When blocked, `getIndexLayer()` returns a local placeholder grid layer and fires a `sentinelguard` map event instead of constructing WMS tile requests. The GIF/acquisition helper path is also skipped while the guard is blocking.

**Sentinel Hub WMS rate contract**: Live Sentinel Hub WMS must be conservative. The WMS tile layer uses 512px tiles, one concurrent fetch, no zoom-time update burst, and HTTP 429 `Retry-After` cooldown handling. When rate limited, it fires `sentinelratelimit` so the toolbar can show a cooldown message instead of continuing to hammer the account.

**Sentinel Hub WMS collection/QA contract**: OGC WMS evalscripts run against the collection assigned to the requested configuration layer. The bundled `AGRICULTURE` carrier is Sentinel-2 L1C and therefore has no L2A `SCL` band. Core Limn defaults `SENTINEL_WMS_SUPPORTS_SCL` to `false`; `getScriptContent()` removes the explicitly marked SCL input/gate for this optional WMS path, and the UI reports the limitation. Set the flag to `true` only after verifying that the configured WMS layer is backed by Sentinel-2 L2A. L2A COG and GEE remain the preferred pixel-QA paths and retain SCL masking.

**2026-07-24 — L2A layer added to instance `83a6b821-c0ad-43b1-848f-06f7b6b528a7`**: a genuine `SENTINEL-2-L2A` layer (Source: "Sentinel-2 - L2A" in the Configuration Utility) now exists alongside the original `AGRICULTURE` (L1C) layer on this same instance. `config-v1.js` sets `SH_WMS_LAYER: "SENTINEL-2-L2A"` and `SENTINEL_WMS_SUPPORTS_SCL: true` for both Limn and Atlas — verified live (real WMS request captured with `layers=SENTINEL-2-L2A`). Limn's WMS layer name was previously hardcoded to `'AGRICULTURE'` in 5 call sites (`map.js` x2, `report.js` x2, `app.js` x2) with no config override at all, unlike Atlas's pre-existing `ATLAS_WMS_LAYER`; all now read `config.SH_WMS_LAYER || 'AGRICULTURE'`. `getIndexLayer()` (`map.js`) now falls back to the free COG renderer (for indices it implements) instead of an inert placeholder tile whenever Sentinel Hub is the configured provider but the credit guard blocks it — verified both guard states live. `IMAGE_PROVIDER` itself is still `"cog"` by default; see `knowledge/DECISIONS.md` 2026-07-24 for why flipping that requires more than a config change.

Atlas follows the same WMS rate contract through its own `FetchWMS` implementation and `ratelimit` event path.

## Sentinel Hub WMS

**Endpoint**: `https://sh.dataspace.copernicus.eu/ogc/wms/{INSTANCE_ID}`

`{INSTANCE_ID}` must be a Sentinel Hub OGC WMS configuration id. The alternate Atlas id `83a6b821-c0ad-43b1-848f-06f7b6b528a7` returns `200 application/xml` for `GetCapabilities`. A Copernicus Browser/Viewer id such as `sh-d7374040-889f-4013-aac2-046a15f6d8ba` is not enough for `GetMap`; direct probes returned HTTP 404/400 when used as an OGC WMS path segment.

Key params sent by `getWMSLayer()`:
- `layers`: `'AGRICULTURE'` (default), `'SENTINEL1-GRD'` (SAR), or `'SENTINEL-2-L2A,LANDSAT-8-L2A'` (HLS)
- `evalscript`: base64-encoded script (URL-encoded first, then base64)
- `time`: `'YYYY-MM-DD'` or range `'YYYY-MM-DD/YYYY-MM-DD'`
- `maxcc`: cloud cover % (20 for normal, 100 for scan/highlight)
- `version`: `'1.3.0'`
- `format`: `'image/png'`
- `transparent`: `true`

**Encoding pattern** (strip comments, trim lines, then encode):
```javascript
btoa(unescape(encodeURIComponent(
    scriptContent
        .replace(/\/\*[\s\S]*?\*\/|([^\:]|^)\/\/.*$/gm, '$1')
        .split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n')
)))
```

**Current core boundary:** No shipped Limn layer uses Sentinel-1/Sentinel-2 fusion. ASAI and OBEC are Sentinel-2-only surface-response composites; the multi-source helper is legacy and unused.

## Sentinel Hub Statistics API

**Endpoint**: `https://sh.dataspace.copernicus.eu/api/v1/statistics`

**Auth**: Bearer token from CDSE OAuth2 (see auth section below).

Used by: 1-year AOI scan (`btn-scan-aoi`), `probeAcquisitions()`, and the report-generation handler in `src/app.js`.

Response structure:
```javascript
data.data[i].interval.from       // ISO date string
data.data[i].outputs.default.bands.B0.stats.mean   // per-band stats
data.data[i].outputs.default.bands.B0.stats.sampleCount  // 0 = no valid pixels (cloudy)
```

**Resolution**: 60m used for scan (speed), 10m used for report charts.

## CDSE OAuth2 Authentication (`auth.js`)

**Token endpoint**: `https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token`
**Routing**: Via `corsproxy.io` (Copernicus Keycloak blocks direct frontend CORS)
**Grant type**: `client_credentials`
**Caching**: Token cached in module-level variables; auto-refreshed 60s before expiry

**Config source**: `window.CONFIG.CDSE_CLIENT_ID` and `window.CONFIG.CDSE_CLIENT_SECRET` (set by `config-v1.js`).

⚠️ Credentials are currently hardcoded in `config-v1.js`. This file must NOT be committed. Add to `.gitignore` and use `config.example.js` as the template.

## Nominatim Geocoding (Location Search)

**Endpoint**: `https://nominatim.openstreetmap.org/search?format=json&limit=1&q={query}`
**Used by**: Location search in sidebar (`handleLocationSearch`)
**Note**: No auth required. Rate-limited; not suitable for batch use.

## RRC Spill Data

**Source**: `./data/rrc_spills.json` (local GeoJSON file)
**Schema**: Standard GeoJSON FeatureCollection with properties: `operator`, `county`, `district`, `date`, `volume_bbl`, `incident_type`, `description`
**Cached**: On first fetch into `state.rrcSpillData`; reload page to refresh.
