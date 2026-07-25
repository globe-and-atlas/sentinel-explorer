/* ==========================================================================
   Globe & Atlas · Limn — Atlas App
   Simplified viewer for the Global Spectral Index Atlas (91 proposed index specifications).
   No produced-water tools. Each index navigates to a curated bookmark.
   ========================================================================== */

import {
  ATLAS_INDICES as NOVEL_INDICES,
  ATLAS_DOMAINS as NOVEL_DOMAINS,
  ATLAS_CAPABILITIES,
  ATLAS_METHOD_ROLES,
} from './atlas-indices.js?v=7';
import { SAR_DEMO_INDICES, SAR_DEMO_DOMAIN } from './atlas-sar-demos.js?v=2';
import { S5P_DEMO_INDICES, S5P_DEMO_DOMAIN } from './atlas-s5p-demos.js?v=2';
import { countsAsAtlasCitation, getAtlasEvidence, getAtlasTrust } from './atlas-evidence.js?v=4';
import { authorshipClaims } from './authorshipClaims.js?v=1';
import { verifiedBookmarks } from './verifiedBookmarks.js?v=1';
import { getCDSEToken } from './auth.js';
import { fetchValidSentinelDates } from './sentinel-catalog.js';

// The 91 proposed specifications plus the live Sentinel-1 SAR and Sentinel-5P
// TROPOMI demonstrators (kept separate so the catalog stays exactly
// 91). Downstream code uses the merged arrays transparently.
const ATLAS_INDICES = [...NOVEL_INDICES, ...SAR_DEMO_INDICES, ...S5P_DEMO_INDICES];
const ATLAS_DOMAINS = [...NOVEL_DOMAINS, SAR_DEMO_DOMAIN, S5P_DEMO_DOMAIN];

const DEFAULT_GEE_TILE_ENDPOINT = '/api/gee/tiles';
const DEFAULT_SH_WMS_URL = 'https://sh.dataspace.copernicus.eu/ogc/wms/959ea2c5-5892-4b36-82b3-76e6bdb93c8a';
const DEFAULT_SENTINEL_VIEWER_INSTANCE_ID = '83a6b821-c0ad-43b1-848f-06f7b6b528a7';
const DEFAULT_WMS_LAYER = 'AGRICULTURE';
const DEFAULT_SENTINEL_MIN_ZOOM = 14;
const CONTEXT_TRUE_COLOR_EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: ['B04', 'B03', 'B02', 'dataMask'], output: { bands: 4 } };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0,0,0,0];
  return [sample.B04*2.5, sample.B03*2.5, sample.B02*2.5, 1];
}`;

let runtimeAtlasImageProviderOverride = null;
let runtimeAtlasWmsSource = null;

function buildSentinelWmsUrl(instanceId) {
  const value = String(instanceId || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://sh.dataspace.copernicus.eu/ogc/wms/${value}`;
}

function getConfiguredAtlasWmsUrl(cfg) {
  const configuredUrl = cfg.SH_WMS_URL || cfg.ATLAS_WMS_URL;
  if (configuredUrl) return String(configuredUrl);
  return buildSentinelWmsUrl(cfg.SH_INSTANCE_ID || cfg.SENTINEL_HUB_INSTANCE_ID || cfg.WMS_INSTANCE_ID)
    || DEFAULT_SH_WMS_URL;
}

function getAtlasWmsSources(cfg) {
  const configuredUrl = getConfiguredAtlasWmsUrl(cfg);
  const viewerUrl = cfg.ATLAS_VIEWER_WMS_URL
    || cfg.SENTINEL_VIEWER_WMS_URL
    || buildSentinelWmsUrl(cfg.ATLAS_VIEWER_INSTANCE_ID || cfg.SENTINEL_VIEWER_INSTANCE_ID || DEFAULT_SENTINEL_VIEWER_INSTANCE_ID);

  return [
    {
      id: 'configured',
      label: 'Configured Copernicus',
      shortLabel: 'Configured',
      url: String(configuredUrl),
      enabled: Boolean(configuredUrl),
    },
    {
      id: 'viewer',
      label: 'Sentinel Viewer',
      shortLabel: 'Viewer',
      url: String(viewerUrl || ''),
      enabled: Boolean(viewerUrl),
    },
  ];
}

function resolveAtlasWmsSource(cfg) {
  const sources = getAtlasWmsSources(cfg);
  const requested = String(runtimeAtlasWmsSource || cfg.ATLAS_WMS_SOURCE || 'configured').toLowerCase();
  return sources.find(source => source.id === requested && source.enabled)
    || sources.find(source => source.id === 'configured' && source.enabled)
    || sources.find(source => source.id === 'viewer' && source.enabled)
    || {
      id: 'configured',
      label: 'Configured Copernicus',
      shortLabel: 'Configured',
      url: DEFAULT_SH_WMS_URL,
      enabled: true,
    };
}

function getAtlasConfig() {
  const cfg = window.CONFIG || {};
  const wmsSources = getAtlasWmsSources(cfg);
  const wmsSource = resolveAtlasWmsSource(cfg);
  const requestedProvider = String(runtimeAtlasImageProviderOverride || cfg.ATLAS_IMAGE_PROVIDER || cfg.IMAGE_PROVIDER || 'gee').toLowerCase();
  const allowSentinelFallback = runtimeAtlasImageProviderOverride === 'sentinelhub' || cfg.ALLOW_SENTINEL_FALLBACK === true;
  let imageProvider = requestedProvider === 'cog' && !cfg.ATLAS_IMAGE_PROVIDER && !runtimeAtlasImageProviderOverride
    ? 'gee'
    : requestedProvider;
  if (imageProvider === 'sentinelhub' && !allowSentinelFallback) imageProvider = 'gee';

  const configuredMinZoom = Number(cfg.ATLAS_SENTINEL_MIN_ZOOM || cfg.SENTINEL_MIN_ZOOM || DEFAULT_SENTINEL_MIN_ZOOM);
  return {
    imageProvider,
    geeTileEndpoint: String(cfg.ATLAS_GEE_TILE_ENDPOINT || cfg.GEE_TILE_ENDPOINT || DEFAULT_GEE_TILE_ENDPOINT).replace(/\/+$/, ''),
    geeApiKey: cfg.GEE_API_KEY || '',
    wmsUrl: wmsSource.url,
    wmsSource: wmsSource.id,
    wmsSourceLabel: wmsSource.label,
    wmsSources,
    wmsLayer: cfg.ATLAS_WMS_LAYER || cfg.SH_WMS_LAYER || DEFAULT_WMS_LAYER,
    sentinelCreditGuard: cfg.ATLAS_SENTINEL_CREDIT_GUARD ?? cfg.SENTINEL_CREDIT_GUARD ?? true,
    sentinelLiveTiles: cfg.ATLAS_SENTINEL_LIVE_TILES ?? cfg.SENTINEL_LIVE_TILES ?? false,
    sentinelMinZoom: Number.isFinite(configuredMinZoom) ? configuredMinZoom : DEFAULT_SENTINEL_MIN_ZOOM,
  };
}

let atlasConfig = getAtlasConfig();

function refreshAtlasConfig() {
  atlasConfig = getAtlasConfig();
  return atlasConfig;
}

let map, wmsLayer, bookmarkFocusLayer, coordMarker, activeKey = null;
let mapMirror = null;
let mirrorBaseLayer = null;
let BASE_TILES;
let pendingTiles = 0;
let currentLinkedInGroundTruthDraft = '';
let currentCaptureFrame = {};
const bookmarkFocusMarkers = new Map();
const state = {
  date: '2021-08-01',
  opacity: 0.85,
  base: 'esri',
  maxcc: 30,
  windowDays: 15,
  paused: false,
  bookmarkFocusVisible: false,
  captureView: 'overlay',
  captureSplit: 50,
  captureOpacity: 0.85,
  sentinelLiveTiles: false,
  sentinelMinZoom: DEFAULT_SENTINEL_MIN_ZOOM,
  sentinelGuardInitialized: false,
  sentinelRateLimitedUntil: 0,
  captureMode: false,
  captureCardCollapsed: false,
  captureInfoCollapsed: false,
  sidebarMode: 'capabilities',
  validSentinelDates: null, // Set of 'YYYY-MM-DD' strings with a real S1/S2 scene; null until first probe resolves
};

const ATLAS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ATLAS_START_YEAR = 2020;
const ATLAS_ALL_DATES = (() => {
  const out = [];
  const today = new Date();
  let iterDate = new Date(Date.UTC(ATLAS_START_YEAR, 0, 1));
  while (iterDate <= today) {
    const y = iterDate.getUTCFullYear();
    const m = iterDate.getUTCMonth();
    const d = iterDate.getUTCDate();
    const mm = String(m + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    out.push({ value: `${y}-${mm}-${dd}`, label: `${ATLAS_MONTHS[m]} ${d}, ${y}` });
    iterDate.setUTCDate(iterDate.getUTCDate() + 1);
  }
  return out;
})();

// Populates the Atlas date <select> with grouped-by-month options. When `validSet` is provided,
// only dates present in it render (tagged ' [S]') — the fail-open unfiltered list is used before
// the first catalog probe resolves.
function populateAtlasDateOptions(selectEl, validSet) {
  if (!selectEl) return;
  selectEl.innerHTML = '';

  const filtered = validSet ? ATLAS_ALL_DATES.filter(d => validSet.has(d.value)) : ATLAS_ALL_DATES;
  const sorted = [...filtered].reverse(); // newest first

  let currentYear = null;
  let currentMonth = null;
  let currentGroup = null;

  for (const dateObj of sorted) {
    const [yr, mm] = dateObj.value.split('-');
    const mon = ATLAS_MONTHS[parseInt(mm, 10) - 1] || '???';

    if (mon !== currentMonth || yr !== currentYear) {
      currentYear = yr;
      currentMonth = mon;
      currentGroup = document.createElement('optgroup');
      currentGroup.label = `${mon} ${yr}`;
      selectEl.appendChild(currentGroup);
    }

    const opt = document.createElement('option');
    opt.value = dateObj.value;
    opt.textContent = dateObj.label + (validSet ? ' [S]' : '');
    if (validSet) opt.className = 'opt-s2';
    currentGroup.appendChild(opt);
  }
}

// Finds the date string (from ATLAS_ALL_DATES) closest to targetStr, restricted to validSet when
// one is available (fail open otherwise).
function closestAtlasDateValue(targetStr, validSet) {
  const target = new Date(targetStr).getTime();
  if (Number.isNaN(target)) return null;

  const restrict = validSet && validSet.size > 0;
  let closestValue = null;
  let minDiff = Infinity;
  ATLAS_ALL_DATES.forEach((dateOption) => {
    if (restrict && !validSet.has(dateOption.value)) return;
    const diff = Math.abs(new Date(dateOption.value).getTime() - target);
    if (diff < minDiff) {
      minDiff = diff;
      closestValue = dateOption.value;
    }
  });
  return closestValue;
}

// Re-renders the date <select> against a freshly-probed valid-date set, preserving the current
// selection where it survives filtering and snapping to the nearest valid date otherwise.
function rebuildAtlasDateSelector(validSet) {
  const dateInput = document.getElementById('date-input');
  if (!dateInput) return;

  const prevDate = dateInput.value || state.date;
  populateAtlasDateOptions(dateInput, validSet);

  const snapped = closestAtlasDateValue(prevDate, validSet);
  if (snapped) {
    dateInput.value = snapped;
    state.date = snapped;
  }
}

// Probes the CDSE STAC catalog for the current map view and rebuilds the date selector. Mirrors
// Limn's probeAcquisitions() (src/report.js) — kept as a sibling implementation rather than a
// shared function because Atlas has no compare-mode selects and a single string-valued date state.
async function probeAtlasAcquisitions() {
  if (!map) return;

  let validDates = new Set();
  let isTrialMode = false;

  try {
    const center = map.getCenter();
    const token = await getCDSEToken();
    const bbox = [center.lng - 0.05, center.lat - 0.05, center.lng + 0.05, center.lat + 0.05];

    const latest = new Date();
    const past = new Date(Date.UTC((window.CONFIG || {}).START_YEAR || ATLAS_START_YEAR, 0, 1));
    const fromISO = `${past.toISOString().split('.')[0]}Z`;
    const toISO = `${latest.toISOString().split('.')[0]}Z`;

    const result = await fetchValidSentinelDates(bbox, fromISO, toISO, token);
    validDates = result.validDates;
    isTrialMode = result.authError;
  } catch (e) {
    console.warn('[Atlas Probe] failed (switching to trial mode for UI tags):', e);
    isTrialMode = true;
  }

  if (isTrialMode || validDates.size === 0) {
    ATLAS_ALL_DATES.forEach((d, i) => {
      if (i % 5 === 0) validDates.add(d.value); // roughly S2/S1 combined revisit cadence
    });
  }

  state.validSentinelDates = validDates;
  rebuildAtlasDateSelector(validDates);
}

window.getAtlasProviderState = () => {
  refreshAtlasConfig();
  return {
    provider: atlasConfig.imageProvider,
    defaultProvider: getDefaultAtlasProviderLabel().toLowerCase(),
    runtimeAtlasImageProviderOverride,
    wmsSource: atlasConfig.wmsSource,
    wmsSourceLabel: atlasConfig.wmsSourceLabel,
    sentinelLiveTiles: state.sentinelLiveTiles === true,
    sentinelMinZoom: state.sentinelMinZoom,
    sentinelRateLimitedUntil: state.sentinelRateLimitedUntil || 0,
    zoom: map?.getZoom?.() ?? null,
    guardStatus: map ? getAtlasSentinelGuardStatus() : null,
    bookmarkFocusVisible: state.bookmarkFocusVisible === true,
    bookmarkFocusCount: bookmarkFocusMarkers.size,
    status: document.getElementById('atlas-sentinel-status')?.textContent || '',
  };
};

window.getAtlasBookmarkFocusState = () => ({
  visible: state.bookmarkFocusVisible === true,
  markerCount: bookmarkFocusMarkers.size,
  expectedCount: getBookmarkFocusEntries().length,
  activeKey,
});

window.getAtlasCaptureState = () => ({
  enabled: state.captureMode === true,
  activeKey,
  view: state.captureView,
  split: state.captureSplit,
  overlayAvailable: hasCaptureOverlayLayer(),
  interpretationAvailable: hasCaptureInterpretationLayer(),
  providerLabel: captureProviderLabel(),
  overlayOpacity: wmsLayer?.options?.opacity ?? null,
  overlayMask: wmsLayer?.getPane?.()?.style?.maskImage || '',
  overlayClipPath: state.captureView === 'split' ? `inset(0 0 0 ${state.captureSplit}%)` : '',
  status: document.getElementById('capture-status')?.textContent || '',
  ...currentCaptureFrame,
});

function setTileStatus(message = '', type = 'info') {
  const status = document.getElementById('tile-status');
  if (!status) return;
  status.textContent = message;
  status.className = message ? `visible ${type}` : '';
}

function isGeeProvider() {
  return ['gee', 'earthengine', 'earth-engine'].includes(atlasConfig.imageProvider);
}

function isSentinelProvider() {
  return atlasConfig.imageProvider === 'sentinelhub';
}

function getDefaultAtlasProviderLabel() {
  const cfg = window.CONFIG || {};
  const requestedProvider = String(cfg.ATLAS_IMAGE_PROVIDER || cfg.IMAGE_PROVIDER || 'gee').toLowerCase();
  if (requestedProvider === 'sentinelhub' && cfg.ALLOW_SENTINEL_FALLBACK !== true) return 'GEE';
  if (requestedProvider === 'cog' && !cfg.ATLAS_IMAGE_PROVIDER) return 'GEE';
  return requestedProvider.toUpperCase();
}

function syncAtlasSentinelState() {
  if (state.sentinelGuardInitialized) return;
  refreshAtlasConfig();
  state.sentinelLiveTiles = atlasConfig.sentinelLiveTiles === true && atlasConfig.imageProvider === 'sentinelhub';
  state.sentinelMinZoom = atlasConfig.sentinelMinZoom;
  runtimeAtlasImageProviderOverride = state.sentinelLiveTiles ? 'sentinelhub' : null;
  refreshAtlasConfig();
  state.sentinelGuardInitialized = true;
}

function getAtlasSentinelGuardStatus() {
  if (!isSentinelProvider()) return { blocked: false, reason: 'provider' };
  if (atlasConfig.sentinelCreditGuard === false) return { blocked: false, reason: 'disabled' };
  if (!state.sentinelLiveTiles) return { blocked: true, reason: 'disarmed' };
  if (state.sentinelRateLimitedUntil > Date.now()) {
    return { blocked: true, reason: 'cooldown', until: state.sentinelRateLimitedUntil };
  }
  const zoom = Number(map?.getZoom?.() ?? 0);
  const minZoom = Number(state.sentinelMinZoom || atlasConfig.sentinelMinZoom || DEFAULT_SENTINEL_MIN_ZOOM);
  if (Number.isFinite(minZoom) && zoom < minZoom) return { blocked: true, reason: 'zoom', zoom, minZoom };
  return { blocked: false, reason: 'armed', zoom, minZoom };
}

function updateAtlasSentinelUI() {
  refreshAtlasConfig();
  const guardEnabled = atlasConfig.sentinelCreditGuard !== false;
  const isSentinel = isSentinelProvider();
  const sentinelActive = isSentinel && state.sentinelLiveTiles === true;
  const minZoom = state.sentinelMinZoom || atlasConfig.sentinelMinZoom || DEFAULT_SENTINEL_MIN_ZOOM;
  const currentZoom = map?.getZoom?.() ?? 0;
  const toggle = document.getElementById('atlas-toggle-sentinel-live');
  const sourceSelect = document.getElementById('atlas-sentinel-source');
  const zoomSlider = document.getElementById('atlas-sentinel-min-zoom');
  const zoomVal = document.getElementById('atlas-sentinel-min-zoom-val');
  const status = document.getElementById('atlas-sentinel-status');
  const panel = document.querySelector('.atlas-sentinel-panel');

  if (toggle) {
    toggle.checked = sentinelActive;
    toggle.disabled = !guardEnabled;
    toggle.title = sentinelActive
      ? 'Switch Atlas back to its default provider'
      : 'Switch this Atlas session to guarded Sentinel Hub WMS tiles';
  }
  if (sourceSelect) {
    for (const option of sourceSelect.options) {
      const source = atlasConfig.wmsSources.find(item => item.id === option.value);
      option.disabled = !source?.enabled;
      option.textContent = source?.shortLabel || option.textContent;
    }
    sourceSelect.value = atlasConfig.wmsSource;
    sourceSelect.title = `Sentinel WMS source: ${atlasConfig.wmsSourceLabel}`;
  }
  if (panel) panel.classList.toggle('is-armed', sentinelActive);
  if (zoomSlider) {
    zoomSlider.value = String(minZoom);
    zoomSlider.disabled = !guardEnabled;
  }
  if (zoomVal) zoomVal.textContent = `Z${minZoom}+`;

  if (!status) return;
  if (!guardEnabled) {
    status.textContent = 'Guard disabled. Sentinel WMS may request tiles.';
  } else if (!isSentinel) {
    status.textContent = `${getDefaultAtlasProviderLabel()} active. Sentinel source: ${atlasConfig.wmsSourceLabel}.`;
  } else if (!state.sentinelLiveTiles) {
    status.textContent = 'Sentinel disarmed. WMS tiles blocked.';
  } else if (state.sentinelRateLimitedUntil > Date.now()) {
    const seconds = Math.max(1, Math.ceil((state.sentinelRateLimitedUntil - Date.now()) / 1000));
    status.textContent = `Rate limited. Cooling down ${seconds}s.`;
  } else if (currentZoom < minZoom) {
    status.textContent = `Armed, blocked until Z${minZoom}+ (current Z${currentZoom}).`;
  } else {
    status.textContent = `Sentinel ${atlasConfig.wmsSourceLabel} armed at Z${currentZoom}.`;
  }
}

function getWmsCarrierLayer(idx) {
  if (!idx.canRender) return atlasConfig.wmsLayer;
  return idx.wmsLayer || atlasConfig.wmsLayer;
}

function getDisplayEvalscript(idx) {
  return idx.canRender ? idx.evalscript : CONTEXT_TRUE_COLOR_EVALSCRIPT;
}

// --- Coverage model ------------------------------------------------------
// The 91 proposed specifications render at three implementation levels.
// 'live' = a screening proxy renders now. 'pending' = executable or calibration
// work exists but is not exposed as a live result. 'sensor' = the record remains
// a formula/workflow specification. Demonstrators are not part of the 91.
function isDemo(idx) {
  return idx.novelty === 'DEMO';
}

function coverageTier(idx) {
  if (idx.canRender) return 'live';
  if (idx.maturity === 'M2' || /(implementation target|calibration) pending/i.test(idx.platform || '')) return 'pending';
  return 'sensor';
}

function coverageCounts() {
  const c = { live: 0, pending: 0, sensor: 0, demo: 0 };
  for (const i of ATLAS_INDICES) {
    if (isDemo(i)) { c.demo++; continue; }
    c[coverageTier(i)]++;
  }
  return c;
}

// Clean short tag for the sidebar button (implementation-pending indices carry a verbose
// platformShort, so derive a concise label from the tier instead).
function tierTag(idx) {
  const tier = coverageTier(idx);
  if (tier === 'pending' && /sentinel-1|s1/i.test(`${idx.platform} ${idx.platformShort}`)) return 'S1 · soon';
  if (tier === 'pending' && /tropomi|s5p/i.test(`${idx.platform} ${idx.platformShort}`)) return 'S5P · soon';
  if (tier === 'pending') return 'S2 · soon';
  return idx.platformShort;
}

// Bands the index's evalscript actually reads (from setup().input, minus dataMask).
function indexBands(idx) {
  const m = (idx.evalscript || '').match(/input\s*:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return m[1].split(',')
    .map(s => s.trim().replace(/['"]/g, ''))
    .filter(b => b && b !== 'dataMask');
}

// Human-readable bands line for the info panel. Live/pending entries have a real
// evalscript, so list the bands; sensor-limited stubs render True Color only.
function bandsLabel(idx) {
  if (coverageTier(idx) === 'sensor') {
    return `Requires ${idx.platformShort} — not computable from Sentinel-2`;
  }
  const bands = indexBands(idx);
  return bands.length ? bands.join(', ') : '—';
}

// GSIA v2 records priority as "not established" until an entry-level prior-art
// dossier exists. Records with an explicit claim show it; the rest show that
// default rather than an invented claim, so all 91 are covered honestly.
const DEFAULT_AUTHORSHIP_CLAIM =
  'No entry-level priority claim is made. GSIA documents this record as a versioned, inspectable '
  + 'specification; scientific priority is not asserted and remains subject to entry-level prior-art review.';
const DEFAULT_DO_NOT_CLAIM =
  'This record does not assert invention of its component indices, first use of its band combination, '
  + 'or any validated detection capability. It has not been independently evaluated (below V1).';

function renderAuthorshipClaim(index) {
  const claimEl = document.getElementById('info-authorship');
  const doNotEl = document.getElementById('info-do-not-claim');
  if (!claimEl || !doNotEl) return;

  if (isDemo(index)) {
    claimEl.textContent = 'Established sensor product demonstration; outside the 91-record catalog and excluded from contribution claims.';
    doNotEl.textContent = 'This demonstration does not assert an original formulation.';
    return;
  }

  const entry = authorshipClaims[index.key];
  const status = index.contributionStatus || 'Provisional; entry-level prior-art review pending';
  // `level`/`strength` in the claims file are the author's own confidence notes.
  // They are deliberately NOT surfaced: GSIA v2 records priority as not
  // established, so a "strongly defensible" badge would contradict the registry.
  claimEl.textContent = entry?.claim
    ? `${entry.claim} Contribution class ${index.contribution || 'C1'} — ${status}.`
    : `${DEFAULT_AUTHORSHIP_CLAIM} Contribution class ${index.contribution || 'C1'} — ${status}.`;
  doNotEl.textContent = entry?.doNotClaim || DEFAULT_DO_NOT_CLAIM;
}

function renderEvidencePanel(index) {
  const trust = getAtlasTrust(index);
  const trustEl = document.getElementById('info-trust');
  const evidenceEl = document.getElementById('info-evidence');
  if (!trustEl || !evidenceEl) return;

  trustEl.textContent = `${trust.label} · ${trust.citationCount} cited sources`;
  trustEl.className = `info-badge info-trust info-trust--${trust.tier.toLowerCase()}`;
  trustEl.title = trust.description;

  evidenceEl.replaceChildren();
  const evidence = getAtlasEvidence(index);
  const citedSources = evidence.filter(countsAsAtlasCitation);
  const referenceLinks = evidence.filter(item => item.url && !item.technical && !countsAsAtlasCitation(item));
  const technicalLinks = evidence.filter(item => item.url && item.technical === true);

  function appendEvidenceGroup(title, items, options = {}) {
    if (!items.length) return;
    const groupTitle = document.createElement('div');
    groupTitle.className = 'evidence-group-title';
    groupTitle.textContent = title;

    const list = document.createElement('div');
    list.className = 'evidence-list';
    items.slice(0, options.limit ?? 4).forEach((item, index) => {
      const link = document.createElement('a');
      link.className = 'evidence-link';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = item.note || item.label;

      const type = document.createElement('span');
      type.className = 'evidence-type';
      type.textContent = options.numbered ? `Source ${index + 1}` : item.type;

      const label = document.createElement('span');
      label.className = 'evidence-label';
      label.textContent = item.label;

      link.append(type, label);
      list.append(link);
    });
    evidenceEl.append(groupTitle, list);
  }

  appendEvidenceGroup('Cited sources', citedSources, { numbered: true });
  appendEvidenceGroup('Supporting references', referenceLinks);
  appendEvidenceGroup('Technical checks', technicalLinks);
  appendEvidenceGroup('Reviewed event references', eventReferencesFor(index), { limit: 6 });
}

// Source-reviewed incidents behind a record. The date shown is the Sentinel-2
// search-window end, NOT an acquisition timestamp. Where the event predates the
// mission there is no observable date at all, and the row says so rather than
// offering one that cannot return imagery.
function eventReferencesFor(index) {
  const rows = verifiedBookmarks[index.key];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => row.sourceUrl)
    .map(row => {
      let type;
      if (row.sentinelObservable === false) {
        type = `${String(row.eventDate || '').slice(0, 4)} · pre-Sentinel-2`;
      } else if (row.sentinelObservable === 'sparse') {
        type = `${row.date} · sparse archive`;
      } else {
        type = row.date;
      }
      const note = row.sentinelObservable === false
        ? `${row.note || ''} Event predates Sentinel-2 (launched 2015-06-23), so no scene of it exists; the site remains inspectable at a later date.`.trim()
        : row.note;
      return { url: row.sourceUrl, label: row.label, type, note };
    });
}

function firstSentence(text, fallback = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  const match = clean.match(/^(.+?[.!?])(\s|$)/);
  return (match ? match[1] : clean).trim();
}

function trimWords(text, limit) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(' ');
  return `${words.slice(0, limit).join(' ')}...`;
}

function linkedinGroundTruthForIndex(idx) {
  const bm = idx.bookmark || {};
  const bands = bandsLabel(idx);
  const capability = capabilityFor(idx);
  const role = methodRoleMeta(idx);
  const familyLabel = capability?.label || 'Operational sensor demonstration';
  const visualAnchor = `One ${role.label.toLowerCase()} method from the ${familyLabel} family: ${idx.acronym} over ${bm.label || 'the selected bookmark'} on ${bm.date || state.date}.`;
  const observation = `${idx.acronym} uses ${bands}. ${firstSentence(idx.physics, idx.name)}`;
  const why = firstSentence(idx.benefit, 'It turns an otherwise subtle landscape condition into a visible inspection target.');
  const question = `What does ${idx.acronym} add beyond sibling methods in ${familyLabel}, and what nearby look-alikes could make it lie?`;
  const post = [
    `One image worth studying this week: ${idx.acronym} over ${bm.label || 'a selected Atlas bookmark'}. It is cataloged as a ${role.label.toLowerCase()} method inside Limn Atlas's ${familyLabel} capability—not as an independently validated invention.`,
    '',
    `The observation is simple: ${trimWords(observation, 42)}`,
    '',
    `Why it matters: ${trimWords(why, 34)}`,
    '',
    `The interpretive prompt I keep coming back to: ${question}`
  ].join('\n');

  return {
    visualAnchor,
    observation,
    why,
    question,
    post: trimWords(post, 295),
  };
}

function renderLinkedInGroundTruth(idx) {
  const draft = linkedinGroundTruthForIndex(idx);
  currentLinkedInGroundTruthDraft = draft.post;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('gt-visual-anchor', draft.visualAnchor);
  setText('gt-observation', draft.observation);
  setText('gt-why', draft.why);
  setText('gt-question', draft.question);
  setText('gt-linkedin-draft', draft.post);
}

function captureFrameForIndex(idx) {
  const bm = idx.bookmark || {};
  const capability = capabilityFor(idx);
  const role = methodRoleMeta(idx);
  const place = `${bm.label || 'Selected Atlas bookmark'} · ${bm.date || state.date}`;
  const modeLabel = captureModeLabel(idx);
  const hook = trimWords(
    `${idx.acronym} is the ${role.label.toLowerCase()} method in ${capability?.label || 'this sensor demonstration'}; compare its result with true color to see what it makes easier to inspect.`,
    32
  );
  const prompt = `Use Split when posting: context shows the landscape, ${idx.acronym} shows the candidate signal, and the next step is checking look-alikes before trusting it.`;

  return {
    acronym: idx.acronym,
    name: idx.name,
    place,
    modeLabel,
    overlayLabel: `${idx.acronym} overlay`,
    hook,
    prompt,
    aspect: '1200x628',
  };
}

function captureModeLabel(idx) {
  if (state.captureView === 'context') return 'Satellite context only';
  if (state.captureView === 'split') return `Split: context vs ${idx.acronym}`;
  return `Satellite context + ${idx.acronym} overlay`;
}

function activeCaptureIndex() {
  return ATLAS_INDICES.find(i => i.key === activeKey) || null;
}

function hasCaptureOverlayLayer() {
  const layerContainer = wmsLayer?.getContainer?.();
  const onMap = !map || !wmsLayer || !map.hasLayer ? Boolean(wmsLayer) : map.hasLayer(wmsLayer);
  return Boolean(wmsLayer && layerContainer && onMap);
}

function hasCaptureInterpretationLayer() {
  const idx = activeCaptureIndex();
  return Boolean(hasCaptureOverlayLayer() && idx?.canRender && isSentinelProvider());
}

function captureProviderLabel() {
  refreshAtlasConfig();
  if (isGeeProvider()) return 'GEE context only';
  if (isSentinelProvider()) return `Sentinel WMS · ${atlasConfig.wmsSourceLabel || 'configured'}`;
  return `${getDefaultAtlasProviderLabel()} context`;
}

function captureInterpretationOpacity() {
  return state.captureOpacity;
}

function captureUnavailableMessage() {
  if (state.paused) return 'Render overlay first: tiles are paused.';
  const idx = activeCaptureIndex();
  if (idx && !idx.canRender) return 'This entry is context-only — choose a live index to compare.';
  if (!isSentinelProvider()) {
    return 'Switch Sentinel WMS on before Capture to compare index overlays.';
  }
  if (isSentinelProvider()) {
    const guardStatus = getAtlasSentinelGuardStatus();
    if (guardStatus.blocked && guardStatus.reason === 'zoom') {
      return `Render overlay first: Sentinel is guarded below Z${guardStatus.minZoom}.`;
    }
    if (guardStatus.blocked && guardStatus.reason === 'cooldown') {
      return 'Render overlay first: Sentinel is cooling down after a rate limit.';
    }
    if (guardStatus.blocked) return 'Render overlay first: Sentinel tiles are disarmed.';
  }
  return 'Render overlay first to use Overlay or Split.';
}

function renderCaptureOverlay(idx) {
  currentCaptureFrame = captureFrameForIndex(idx);
  if (state.captureMode && !hasCaptureInterpretationLayer()) {
    currentCaptureFrame = {
      ...currentCaptureFrame,
      modeLabel: 'Satellite context only',
      hook: 'Render a Sentinel WMS index layer before capturing a comparison frame.',
      prompt: captureUnavailableMessage(),
    };
  }

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('capture-title', currentCaptureFrame.acronym);
  setText('capture-name', currentCaptureFrame.name);
  setText('capture-place', currentCaptureFrame.place);
  setText('capture-mode-label', currentCaptureFrame.modeLabel);
  setText('capture-provider-label', captureProviderLabel());
  setText('capture-overlay-label', currentCaptureFrame.overlayLabel);
  setText('capture-split-overlay-label', currentCaptureFrame.overlayLabel);
  setText('capture-hook', currentCaptureFrame.hook);
  setText('capture-prompt', currentCaptureFrame.prompt);
}

function applyCaptureComparison() {
  const mapArea = document.getElementById('atlas-map-area');

  const layerContainer = wmsLayer?.getContainer?.();
  const layerPane = wmsLayer?.getPane?.();
  if (!wmsLayer || !layerContainer) return;
  const interpretationAvailable = hasCaptureInterpretationLayer();

  const isMirror = state.captureView === 'mirror';
  const splitPct = isMirror ? 50 : state.captureSplit;
  if (mapArea) mapArea.style.setProperty('--capture-split', `${splitPct}%`);

  function clearMask() {
    if (layerPane) {
      layerPane.style.width = '';
      layerPane.style.height = '';
      layerPane.style.maskImage = '';
      layerPane.style.webkitMaskImage = '';
      layerPane.style.clipPath = '';
      layerPane.style.webkitClipPath = '';
    }
  }

  if (!state.captureMode) {
    clearMask();
    layerContainer.classList.remove('capture-interpretation-layer');
    wmsLayer.setOpacity(state.opacity);
    return;
  }

  if (state.captureView === 'context') {
    clearMask();
    layerContainer.classList.remove('capture-interpretation-layer');
    wmsLayer.setOpacity(0);
    return;
  }

  if (state.captureView === 'overlay') {
    clearMask();
    layerContainer.classList.add('capture-interpretation-layer');
    wmsLayer.setOpacity(captureInterpretationOpacity());
    return;
  }

  layerContainer.classList.toggle('capture-interpretation-layer', interpretationAvailable);
  wmsLayer.setOpacity(captureInterpretationOpacity());

  if (state.captureView === 'split') {
    // Swipe/Split: clip overlay layer pane using viewport coordinates converted to layer space
    const container = map.getContainer();
    const width = container.clientWidth;
    const height = container.clientHeight;
    const nw = map.containerPointToLayerPoint([0, 0]);
    const se = map.containerPointToLayerPoint([width, height]);
    const splitPx = Math.round(width * splitPct / 100);
    const clipX = map.containerPointToLayerPoint([splitPx, 0]).x;

    const clipPathVal = `polygon(${clipX}px ${nw.y - 200}px, ${se.x + 200}px ${nw.y - 200}px, ${se.x + 200}px ${se.y + 200}px, ${clipX}px ${se.y + 200}px)`;
    layerPane.style.clipPath = clipPathVal;
    layerPane.style.webkitClipPath = clipPathVal;
  } else {
    clearMask();
  }
}

function syncMirrorMap() {
  const mirrorEl = document.getElementById('atlas-map-mirror');
  const mainEl = document.getElementById('atlas-map');
  const wasMirror = mirrorEl && mirrorEl.style.display !== 'none';
  const clean = document.querySelector('.atlas-layout')?.classList.contains('capture-clean');
  const isMirror = state.captureView === 'mirror' && state.captureMode && !clean;

  if (!isMirror) {
    if (wasMirror) {
      // Hide mirror map and restore main map to 100%
      if (mirrorEl) mirrorEl.style.display = 'none';
      if (mainEl) {
        mainEl.style.width = '100%';
        mainEl.style.height = '100%';
        mainEl.style.position = '';
        mainEl.style.left = '';
        mainEl.style.top = '';
      }
      if (map) map['invalidateSize']({ animate: false });
    }
    return;
  }

  // We are in mirror view
  const center = map.getCenter();
  const zoom = map.getZoom();

  if (!wasMirror) {
    if (mirrorEl && mainEl) {
      mirrorEl.style.display = 'block';
      mirrorEl.style.width = '50%';
      mirrorEl.style.height = '100%';
      mirrorEl.style.position = 'absolute';
      mirrorEl.style.left = '0';
      mirrorEl.style.top = '0';

      mainEl.style.width = '50%';
      mainEl.style.height = '100%';
      mainEl.style.position = 'absolute';
      mainEl.style.left = '50%';
      mainEl.style.top = '0';
    }
  }

  if (!mapMirror) {
    mapMirror = L.map('atlas-map-mirror', {
      center: center,
      zoom: zoom,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false
    });
  }

  // Sync active base layer
  if (mirrorBaseLayer) {
    mapMirror.removeLayer(mirrorBaseLayer);
  }
  const activeUrl = BASE_TILES[state.base]._url;
  const activeOpts = { ...BASE_TILES[state.base].options, attribution: '' };
  mirrorBaseLayer = L.tileLayer(activeUrl, activeOpts);
  mirrorBaseLayer.addTo(mapMirror);

  map['invalidateSize']({ animate: false });
  mapMirror['invalidateSize']({ animate: false });

  map.setView(center, zoom, { animate: false });
  mapMirror.setView(center, zoom, { animate: false });
}

function syncCaptureCardCollapse() {
  const card = document.getElementById('capture-card');
  if (!card) return;
  card.classList.toggle('collapsed', state.captureCardCollapsed);

  const btn = document.getElementById('capture-collapse-btn');
  if (btn) {
    btn.textContent = state.captureCardCollapsed ? '+' : '−';
    btn.setAttribute('title', state.captureCardCollapsed ? 'Expand panel' : 'Minimize panel');
  }
}

function updateCaptureInfoBox() {
  const infoBox = document.getElementById('capture-info-box');
  if (!infoBox) return;

  const idx = activeCaptureIndex();
  if (!idx) {
    infoBox.style.display = 'none';
    return;
  }

  const center = map.getCenter();
  const zoom = map.getZoom();
  const lat = center.lat.toFixed(4);
  const lng = center.lng.toFixed(4);

  const bm = idx.bookmark || {};
  const placeName = bm.label || 'Custom Location';

  const titleEl = document.getElementById('capture-info-title');
  if (titleEl) titleEl.textContent = `${idx.acronym} · ${idx.name}`;

  const sensorEl = document.getElementById('capture-info-sensor');
  if (sensorEl) {
    let platformText = idx.platform || 'Sentinel-2';
    if (platformText.includes('Sentinel-2') || platformText.includes('S2')) {
      if (platformText.includes('S1') || platformText.includes('Sentinel-1')) {
        platformText = 'Sentinel-2 + Sentinel-1';
      } else if (platformText.includes('Landsat')) {
        platformText = 'Sentinel-2 + Landsat';
      } else if (platformText.includes('EMIT')) {
        platformText = 'Sentinel-2 + EMIT';
      } else if (platformText.includes('PACE')) {
        platformText = 'Sentinel-2 + PACE';
      } else if (platformText.includes('DESIS')) {
        platformText = 'Sentinel-2 + DESIS';
      } else if (platformText.includes('EnMAP')) {
        platformText = 'Sentinel-2 + EnMAP';
      } else if (platformText.includes('ECOSTRESS')) {
        platformText = 'Sentinel-2 + ECOSTRESS';
      } else if (platformText.includes('PRISMA')) {
        platformText = 'Sentinel-2 + PRISMA';
      } else {
        platformText = 'Sentinel-2';
      }
    }
    sensorEl.textContent = platformText;
  }

  const dateEl = document.getElementById('capture-info-date');
  if (dateEl) dateEl.textContent = `${state.date}`;

  const locEl = document.getElementById('capture-info-location');
  if (locEl) locEl.textContent = `${placeName} (${lat}, ${lng})`;

  const bandsEl = document.getElementById('capture-info-bands');
  if (bandsEl) bandsEl.textContent = bandsLabel(idx);

  const formulaEl = document.getElementById('capture-info-formula');
  if (formulaEl) {
    formulaEl.textContent = `${idx.formula || 'N/A'}`;
    formulaEl.title = idx.formula || '';
  }
}

function updateLegendMetadata() {
  const locEl = document.getElementById('legend-location-label');
  const coordsEl = document.getElementById('legend-coords-label');
  const formulaEl = document.getElementById('legend-formula-label');
  const bandsEl = document.getElementById('legend-bands-label');

  const idx = activeCaptureIndex();
  if (!idx) {
    if (locEl) locEl.textContent = '';
    if (coordsEl) coordsEl.textContent = '';
    if (formulaEl) { formulaEl.textContent = ''; formulaEl.title = ''; }
    if (bandsEl) bandsEl.textContent = '';
    return;
  }

  const center = map.getCenter();
  const lat = center.lat.toFixed(4);
  const lng = center.lng.toFixed(4);

  const bm = idx.bookmark || {};
  const placeName = bm.label || 'Custom Location';

  if (locEl) locEl.textContent = placeName;
  if (coordsEl) coordsEl.textContent = `${lat}, ${lng}`;

  if (formulaEl) {
    formulaEl.textContent = idx.formula || 'N/A';
    formulaEl.title = idx.formula || '';
  }

  if (bandsEl) {
    bandsEl.textContent = `Bands: ${bandsLabel(idx)}`;
  }
}

function syncCaptureInfoBox() {
  const infoBox = document.getElementById('capture-info-box');
  const trigger = document.getElementById('capture-info-trigger');
  if (!infoBox || !trigger) return;

  const showBox = state.captureMode && !state.captureInfoCollapsed;
  const showTrigger = state.captureMode && state.captureInfoCollapsed;

  infoBox.style.display = showBox ? 'flex' : 'none';
  trigger.style.display = showTrigger ? 'flex' : 'none';

  if (showBox) {
    updateCaptureInfoBox();
  }
}

function syncCaptureControls() {
  const interpretationAvailable = hasCaptureInterpretationLayer();
  if (state.captureMode && !interpretationAvailable && state.captureView !== 'context') {
    state.captureView = 'context';
  }

  const layout = document.querySelector('.atlas-layout');
  if (layout) {
    layout.classList.toggle('capture-view-context', state.captureView === 'context');
    layout.classList.toggle('capture-view-overlay', state.captureView === 'overlay');
    layout.classList.toggle('capture-view-split', state.captureView === 'split');
    layout.classList.toggle('capture-view-mirror', state.captureView === 'mirror');
    layout.classList.toggle('capture-overlay-unavailable', state.captureMode && !interpretationAvailable);
  }

  document.querySelectorAll('.capture-mode-btn').forEach(btn => {
    const view = btn.dataset.captureView;
    const disabled = !interpretationAvailable && view !== 'context';
    const active = btn.dataset.captureView === state.captureView;
    btn.classList.toggle('active', active);
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const splitControl = document.querySelector('.capture-split-control');
  if (splitControl) {
    splitControl.classList.toggle('visible', state.captureView === 'split' && interpretationAvailable);
    splitControl.classList.toggle('disabled', !interpretationAvailable);
  }

  const splitSlider = document.getElementById('capture-split-slider');
  if (splitSlider) {
    splitSlider.value = String(state.captureSplit);
    splitSlider.disabled = !interpretationAvailable || state.captureView !== 'split';
  }

  const status = document.getElementById('capture-status');
  if (status) {
    const message = state.captureMode && !interpretationAvailable ? captureUnavailableMessage() : '';
    status.textContent = message;
    status.classList.toggle('visible', Boolean(message));
  }

  const idx = activeCaptureIndex();
  if (idx) renderCaptureOverlay(idx);
  applyCaptureComparison();
  syncCaptureInfoBox();
}

function setCaptureView(view) {
  if (!['context', 'overlay', 'split', 'mirror'].includes(view)) return;
  if (view !== 'context' && !hasCaptureInterpretationLayer()) view = 'context';
  state.captureView = view;
  syncMirrorMap();
  syncCaptureControls();
}

function setCaptureMode(enabled) {
  state.captureMode = enabled === true;
  if (!state.captureMode && state.captureView === 'mirror') {
    state.captureView = 'overlay';
  }
  const layout = document.querySelector('.atlas-layout');
  if (layout) layout.classList.toggle('capture-mode', state.captureMode);

  const toggle = document.getElementById('toggle-capture');
  if (toggle) {
    toggle.classList.toggle('capture-active', state.captureMode);
    toggle.setAttribute('aria-pressed', state.captureMode ? 'true' : 'false');
  }

  const idx = activeCaptureIndex();
  if (idx) renderCaptureOverlay(idx);
  syncMirrorMap();
  syncCaptureControls();
  positionLegend();

  state.captureCardCollapsed = false;
  state.captureInfoCollapsed = false;
  syncCaptureCardCollapse();
  syncCaptureInfoBox();

  if (map) setTimeout(() => {
    updateCaptureFrameGuide();
  }, 50);
}

function updateCaptureFrameGuide() {
  const guide = document.getElementById('capture-frame-guide');
  const mapArea = document.getElementById('atlas-map-area');
  if (!guide || !mapArea) return;
  const mapW = mapArea.clientWidth;
  const mapH = mapArea.clientHeight;
  const targetAspect = 1200 / 628;
  const srcAspect = mapW / mapH;
  let frameW, frameH;
  if (srcAspect > targetAspect) {
    frameH = mapH;
    frameW = Math.round(mapH * targetAspect);
  } else {
    frameW = mapW;
    frameH = Math.round(mapW / targetAspect);
  }
  guide.style.width = `${frameW}px`;
  guide.style.height = `${frameH}px`;

  const offsetX = Math.max(0, Math.round((mapW - frameW) / 2));
  const offsetY = Math.max(0, Math.round((mapH - frameH) / 2));
  mapArea.style.setProperty('--capture-offset-x', `${offsetX}px`);
  mapArea.style.setProperty('--capture-offset-y', `${offsetY}px`);

  if (state.captureMode) {
    if (state.captureView === 'split') {
      applyCaptureComparison();
    } else if (state.captureView === 'mirror') {
      syncMirrorMap();
    }
  }
}

function _captureCenterCrop(src, ctx, targetW, targetH) {
  const srcAspect = src.width / src.height;
  const tgtAspect = targetW / targetH;
  let sx = 0, sy = 0, sw = src.width, sh = src.height;
  if (srcAspect > tgtAspect) {
    sw = Math.round(src.height * tgtAspect);
    sx = Math.round((src.width - sw) / 2);
  } else {
    sh = Math.round(src.width / tgtAspect);
    sy = Math.round((src.height - sh) / 2);
  }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, targetW, targetH);
}

async function saveCapturePng() {
  const btn = document.getElementById('capture-save-btn');
  const mapArea = document.getElementById('atlas-map-area');
  const layout = document.querySelector('.atlas-layout');
  if (!mapArea || !layout || !window.html2canvas) return;

  const origText = btn.textContent;
  btn.textContent = 'Capturing…';
  btn.disabled = true;

  // Hide UI chrome; clear pane mask+dimensions so html2canvas sees the full overlay
  layout.classList.add('capture-clean');
  syncMirrorMap();
  const layerContainer = wmsLayer?.getContainer?.();
  const layerPane = wmsLayer?.getPane?.();
  if (layerPane) {
    layerPane.style.width = '';
    layerPane.style.height = '';
    layerPane.style.maskImage = '';
    layerPane.style.webkitMaskImage = '';
  }

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const targetW = 1200, targetH = 628;
  const captureOpts = { useCORS: false, allowTaint: false, logging: false, scale: window.devicePixelRatio || 1 };

  try {
    let out;

    if ((state.captureView === 'split' || state.captureView === 'mirror') && wmsLayer && layerContainer) {
      const savedOpacity = wmsLayer.options?.opacity ?? state.opacity;
      const exportOpacity = hasCaptureInterpretationLayer() ? captureInterpretationOpacity() : state.opacity;

      wmsLayer.setOpacity(0);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const baseRaw = await window.html2canvas(mapArea, captureOpts);

      wmsLayer.setOpacity(exportOpacity);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const overlayRaw = await window.html2canvas(mapArea, captureOpts);
      wmsLayer.setOpacity(savedOpacity);

      out = document.createElement('canvas');
      out.width = targetW;
      out.height = targetH;
      const ctx = out.getContext('2d');

      if (state.captureView === 'mirror') {
        // Both panels show the same geographic center — render each at full 1200×628 then slice center half
        const half = Math.round(targetW / 2);
        const sliceX = Math.round((targetW - half) / 2); // x=300 for 1200→600

        const baseCanvas = document.createElement('canvas');
        baseCanvas.width = targetW; baseCanvas.height = targetH;
        _captureCenterCrop(baseRaw, baseCanvas.getContext('2d'), targetW, targetH);

        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = targetW; overlayCanvas.height = targetH;
        _captureCenterCrop(overlayRaw, overlayCanvas.getContext('2d'), targetW, targetH);

        ctx.drawImage(baseCanvas, sliceX, 0, half, targetH, 0, 0, half, targetH);
        ctx.drawImage(overlayCanvas, sliceX, 0, half, targetH, half, 0, half, targetH);
      } else {
        // Swipe: full-width base, overlay clipped to right of split point
        _captureCenterCrop(baseRaw, ctx, targetW, targetH);
        const splitX = Math.round(targetW * state.captureSplit / 100);
        ctx.save();
        ctx.beginPath();
        ctx.rect(splitX, 0, targetW - splitX, targetH);
        ctx.clip();
        _captureCenterCrop(overlayRaw, ctx, targetW, targetH);
        ctx.restore();
      }

    } else {
      const raw = await window.html2canvas(mapArea, captureOpts);
      out = document.createElement('canvas');
      out.width = targetW;
      out.height = targetH;
      _captureCenterCrop(raw, out.getContext('2d'), targetW, targetH);
    }

    const slug = (currentCaptureFrame?.acronym || 'atlas').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const date = state.date || new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.download = `limn-${slug}-${date}.png`;
    a.href = out.toDataURL('image/png');
    a.click();

    btn.textContent = 'Saved ✓';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2200);
  } catch (err) {
    console.error('Capture export failed:', err);
    btn.textContent = 'Export failed — try a screenshot';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 3000);
  } finally {
    layout.classList.remove('capture-clean');
    syncMirrorMap();
    // applyCaptureComparison restores the correct mask (including pane dimensions)
    applyCaptureComparison();
  }
}

function getBookmarkFocusEntries() {
  return ATLAS_INDICES.filter(idx => {
    const bm = idx.bookmark || {};
    return Number.isFinite(Number(bm.lat)) && Number.isFinite(Number(bm.lng));
  });
}

function bookmarkFocusColor(idx) {
  const tier = coverageTier(idx);
  if (isDemo(idx)) return '#00FFB2';
  if (tier === 'live') return '#00D2FF';
  if (tier === 'pending') return '#FFB454';
  return '#94A3B8';
}

function bookmarkFocusStyle(idx, isActive = false) {
  const color = isActive ? '#00FFB2' : bookmarkFocusColor(idx);
  return {
    radius: isActive ? 7 : 4,
    color,
    weight: isActive ? 2.5 : 1.25,
    opacity: isActive ? 1 : 0.78,
    fillColor: color,
    fillOpacity: isActive ? 0.78 : 0.38,
    className: `atlas-bookmark-focus-point${isActive ? ' is-active' : ''}`,
    pane: 'atlasBookmarkFocusPane',
  };
}

function ensureBookmarkFocusLayer() {
  if (bookmarkFocusLayer) return bookmarkFocusLayer;
  bookmarkFocusLayer = L.layerGroup();
  bookmarkFocusMarkers.clear();

  for (const idx of getBookmarkFocusEntries()) {
    const bm = idx.bookmark;
    const marker = L.circleMarker(
      [Number(bm.lat), Number(bm.lng)],
      bookmarkFocusStyle(idx, idx.key === activeKey)
    );
    marker.bindTooltip(`${idx.acronym} · ${bm.label}`, {
      direction: 'top',
      opacity: 0.95,
      className: 'atlas-bookmark-focus-tooltip',
    });
    marker.on('add', () => {
      const el = marker.getElement?.();
      if (el) {
        el.dataset.key = idx.key;
        el.setAttribute('aria-label', `${idx.acronym} bookmark focus point`);
      }
    });
    marker.on('click', () => selectIndex(idx.key));
    marker.addTo(bookmarkFocusLayer);
    bookmarkFocusMarkers.set(idx.key, marker);
  }

  return bookmarkFocusLayer;
}

function updateBookmarkFocusButton() {
  const btn = document.getElementById('toggle-bookmark-focus');
  if (!btn) return;
  btn.classList.toggle('is-active', state.bookmarkFocusVisible);
  btn.setAttribute('aria-pressed', state.bookmarkFocusVisible ? 'true' : 'false');
  btn.title = state.bookmarkFocusVisible
    ? 'Hide bookmark focus points'
    : `Show ${getBookmarkFocusEntries().length} bookmark focus points`;
}

function updateBookmarkFocusMarkers() {
  if (!bookmarkFocusLayer) return;
  for (const idx of getBookmarkFocusEntries()) {
    const marker = bookmarkFocusMarkers.get(idx.key);
    if (!marker) continue;
    marker.setStyle(bookmarkFocusStyle(idx, idx.key === activeKey));
  }
}

function setBookmarkFocusVisible(visible) {
  state.bookmarkFocusVisible = visible === true;
  const layer = ensureBookmarkFocusLayer();
  if (state.bookmarkFocusVisible) {
    if (!map.hasLayer(layer)) layer.addTo(map);
  } else if (map.hasLayer(layer)) {
    map.removeLayer(layer);
  }
  updateBookmarkFocusMarkers();
  updateBookmarkFocusButton();
}

function sensorNote(idx) {
  const tier = coverageTier(idx);
  if (tier === 'live') return '';
  if (tier === 'pending') {
    return 'An executable formula or calibration workflow exists, but it is not a live scientific result. Showing True Color context here.';
  }
  return `M1 specification requiring ${idx.platformShort}; showing True Color context rather than an implemented index.`;
}

function extractProviderErrorMessage(text) {
  if (!text) return '';

  try {
    const data = JSON.parse(text);
    return data.detail || data.description || data.message || data.error || '';
  } catch (_) {
    // Sentinel Hub WMS errors are usually XML ServiceException reports.
  }

  const cdataMatch = text.match(/<!\[CDATA\[\s*([\s\S]*?)\s*\]\]>/);
  if (cdataMatch) return cdataMatch[1].replace(/\s+/g, ' ').trim();

  const serviceMatch = text.match(/<ServiceException[^>]*>\s*([\s\S]*?)\s*<\/ServiceException>/i);
  if (serviceMatch) {
    return serviceMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

async function buildProviderFetchError(response) {
  const text = await response.text().catch(() => '');
  const detail = extractProviderErrorMessage(text);
  const err = new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
  err.status = response.status;
  err.statusText = response.statusText;
  err.detail = detail;
  err.isQuotaExhausted = /insufficient processing units|additional credits|requests available|quota/i.test(detail);
  return err;
}

function getTileErrorMessage(layerName, error) {
  const status = error?.status;
  const providerLabel = isGeeProvider() ? 'Earth Engine' : 'Sentinel Hub WMS';
  if (status === 429) {
    return error?.detail
      ? `Atlas ${providerLabel} rate limited ${layerName}: ${error.detail}`
      : `Atlas ${providerLabel} rate limited ${layerName}. Cooling down before retrying.`;
  }
  if (status === 403 && error?.isQuotaExhausted) {
    return `Atlas ${providerLabel} quota/credits unavailable for ${layerName}: ${error.detail}`;
  }
  if (status === 403 && error?.detail) {
    return `Atlas ${providerLabel} denied ${layerName}: ${error.detail}`;
  }
  if (error?.detail) {
    return `Atlas ${providerLabel} tiles failed for ${layerName} (HTTP ${status || 'error'}): ${error.detail}`;
  }
  if (status) return `Atlas ${providerLabel} tiles failed for ${layerName} (HTTP ${status}). Check provider config and date coverage.`;
  return `Atlas ${providerLabel} tiles failed for ${layerName}. Check provider config and date coverage.`;
}

// --- No-data detection ---------------------------------------------------
// Providers can return a fully transparent PNG (HTTP 200) when the time window
// has no available scene. Tiles load via blob:// URLs (same-origin), so
// canvas pixel reads are always untainted — no crossOrigin needed.
const NODATA_CANVAS = document.createElement('canvas');
NODATA_CANVAS.width = NODATA_CANVAS.height = 8;
const NODATA_CTX = NODATA_CANVAS.getContext('2d', { willReadFrequently: true });

function tileHasData(img) {
  try {
    NODATA_CTX.clearRect(0, 0, 8, 8);
    NODATA_CTX.drawImage(img, 0, 0, 8, 8);
    const { data } = NODATA_CTX.getImageData(0, 0, 8, 8);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 8) return true;
    }
    return false;
  } catch {
    return true;
  }
}

// --- Fetch-based tile layers ---------------------------------------------
// Uses fetch() instead of <img src> so we get actual HTTP status codes on
// failure, and tiles load via blob:// URLs (same-origin, no CORS needed).
// Mirrors the RateLimitedWMS pattern in map.js.
const FetchTile = L.TileLayer.extend({
  initialize(url, options = {}) {
    L.TileLayer.prototype.initialize.call(this, url, options);
    this._queue = [];
    this._active = 0;
    this._maxConcurrent = options.maxConcurrent || 2;
    this._retries = options.retries ?? 4;
    this._retryDelay = options.retryDelay || 1500;
  },

  createTile(coords, done) {
    const img = document.createElement('img');
    this._enqueue(this.getTileUrl(coords), img, done, this._retries);
    return img;
  },

  _enqueue(url, img, done, retriesLeft) {
    this._queue.push({ url, img, done, retriesLeft });
    this._drain();
  },

  _drain() {
    while (this._active < this._maxConcurrent && this._queue.length > 0) {
      this._active++;
      this._fetchTile(this._queue.shift());
    }
  },

  _release(error, img, done) {
    this._active--;
    this._drain();
    done(error, img);
  },

  _fetchTile({ url, img, done, retriesLeft }) {
    fetch(url)
      .then(async r => {
        if (r.status === 429 && retriesLeft > 0) {
          this._active--;
          this._drain();
          setTimeout(
            () => this._enqueue(url, img, done, retriesLeft - 1),
            this._retryDelay * Math.max(1, this._retries - retriesLeft + 1)
          );
          return null;
        }
        if (!r.ok) {
          throw await buildProviderFetchError(r);
        }
        return r.blob();
      })
      .then(blob => {
        if (!blob) return;
        const objUrl = URL.createObjectURL(blob);
        img.onload = () => { URL.revokeObjectURL(objUrl); this._release(null, img, done); };
        img.onerror = () => { URL.revokeObjectURL(objUrl); this._release(new Error('decode failed'), img, done); };
        img.src = objUrl;
      })
      .catch(e => this._release(e, img, done));
  }
});

let atlasSentinelWmsCooldownUntil = 0;

function getRetryAfterMs(response, fallbackMs) {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return fallbackMs;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const retryDate = Date.parse(retryAfter);
  if (Number.isFinite(retryDate)) return Math.max(fallbackMs, retryDate - Date.now());
  return fallbackMs;
}

function setAtlasSentinelWmsCooldown(delayMs) {
  atlasSentinelWmsCooldownUntil = Math.max(atlasSentinelWmsCooldownUntil, Date.now() + delayMs);
}

const FetchWMS = L.TileLayer.WMS.extend({
  initialize(url, options = {}) {
    L.TileLayer.WMS.prototype.initialize.call(this, url, options);
    this._queue = [];
    this._active = 0;
    this._cooldownTimer = null;
    this._maxConcurrent = options.maxConcurrent || 1;
    this._retries = options.retries ?? 1;
    this._retryDelay = options.retryDelay || 8000;
  },

  createTile(coords, done) {
    const img = document.createElement('img');
    this._enqueue(this.getTileUrl(coords), img, done, this._retries);
    return img;
  },

  _enqueue(url, img, done, retriesLeft) {
    this._queue.push({ url, img, done, retriesLeft });
    this._drain();
  },

  _drain() {
    const cooldownRemaining = atlasSentinelWmsCooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
      if (!this._cooldownTimer) {
        this._cooldownTimer = setTimeout(() => {
          this._cooldownTimer = null;
          this._drain();
        }, cooldownRemaining + 50);
      }
      return;
    }

    while (this._active < this._maxConcurrent && this._queue.length > 0) {
      this._active++;
      this._fetchTile(this._queue.shift());
    }
  },

  _release(error, img, done) {
    this._active--;
    this._drain();
    done(error, img);
  },

  _fetchTile({ url, img, done, retriesLeft }) {
    fetch(url)
      .then(async r => {
        if (r.status === 429 && retriesLeft > 0) {
          const retryDelayMs = getRetryAfterMs(
            r,
            this._retryDelay * Math.max(1, this._retries - retriesLeft + 1)
          );
          setAtlasSentinelWmsCooldown(retryDelayMs);
          this.fire('ratelimit', { retryAfterMs: retryDelayMs });
          this._active--;
          setTimeout(() => this._enqueue(url, img, done, retriesLeft - 1), retryDelayMs);
          return null;
        }
        if (!r.ok) {
          throw await buildProviderFetchError(r);
        }
        return r.blob();
      })
      .then(blob => {
        if (!blob) return;
        const objUrl = URL.createObjectURL(blob);
        img.onload = () => { URL.revokeObjectURL(objUrl); this._release(null, img, done); };
        img.onerror = () => { URL.revokeObjectURL(objUrl); this._release(new Error('decode failed'), img, done); };
        img.src = objUrl;
      })
      .catch(e => this._release(e, img, done));
  }
});

function stripComments(script) {
  return script
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([^:]|^)\/\/.*$/gm, '$1')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n');
}

function encodeScript(script) {
  const bytes = new TextEncoder().encode(stripComments(script));
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
}

function getTimeWindow(date) {
  const windowDays = state.windowDays;
  const endDate = date;
  const startDate = new Date(new Date(date).getTime() - windowDays * 86400000)
    .toISOString().split('T')[0];
  return { startDate, endDate, timeStr: `${startDate}/${endDate}`, windowDays };
}

function watchTileBatch(layer, layerName) {
  let batchTiles = 0;
  let batchWithData = 0;
  let batchErrored = false;

  function settleBatch() {
    if (pendingTiles > 0) return;
    if (batchErrored) return;
    if (batchTiles > 0 && batchWithData === 0) {
      setTileStatus(
        'No scene data in this window — widen the window or raise cloud tolerance.',
        'info'
      );
    } else {
      setTileStatus('');
    }
  }

  layer.on('tileloadstart', () => {
    pendingTiles++;
    if (pendingTiles === 1) setTileStatus('Loading…', 'loading');
  });
  layer.on('tileload', (event) => {
    pendingTiles = Math.max(0, pendingTiles - 1);
    batchTiles++;
    if (tileHasData(event.tile)) batchWithData++;
    settleBatch();
  });
  layer.on('tileerror', (event) => {
    pendingTiles = Math.max(0, pendingTiles - 1);
    batchErrored = true;
    setTileStatus(getTileErrorMessage(layerName, event.error), 'error');
  });
  layer.on('ratelimit', (event) => {
    const retryAfterMs = Number(event?.retryAfterMs || 15000);
    state.sentinelRateLimitedUntil = Math.max(state.sentinelRateLimitedUntil || 0, Date.now() + retryAfterMs);
    updateAtlasSentinelUI();
    setTileStatus(`Sentinel Hub rate limit reached — cooling down ${Math.ceil(retryAfterMs / 1000)}s.`, 'error');
  });
}

function buildGeeUrl(idx, date, opts = {}) {
  const { timeStr, endDate } = getTimeWindow(date);
  const params = new URLSearchParams({
    app: 'atlas',
    index: idx.key,
    acronym: idx.acronym || idx.key,
    time: timeStr,
    date: endDate,
    source: idx.canRender ? 'index' : 'context',
    platform: idx.platformShort || idx.platform || '',
    minZoom: String(opts.minZoom != null ? opts.minZoom : 10),
    maxcc: String(state.maxcc)
  });
  if (atlasConfig.geeApiKey) params.set('key', atlasConfig.geeApiKey);
  return `${atlasConfig.geeTileEndpoint}/{z}/{x}/{y}?${params.toString()}`;
}

function applyGEE(idx, date, opts = {}) {
  refreshAtlasConfig();
  if (wmsLayer) { map.removeLayer(wmsLayer); wmsLayer = null; }
  if (!idx) return;

  pendingTiles = 0;
  const { windowDays } = getTimeWindow(date);
  const layerName = idx.acronym || idx.key;

  updateWindowDisplay(date, windowDays);
  setTileStatus('');

  wmsLayer = new FetchTile(buildGeeUrl(idx, date, opts), {
    pane: 'atlasWmsPane',
    opacity: state.opacity,
    attribution: 'Google Earth Engine / Limn Atlas',
    tileSize: 256,
    minZoom: opts.minZoom != null ? opts.minZoom : 10,
    updateWhenIdle: true,
    detectRetina: true,
    maxConcurrent: 2,
    retries: 4,
    retryDelay: 1800,
  });
  watchTileBatch(wmsLayer, layerName);
  wmsLayer.addTo(map);
  applyCaptureComparison();
}

function applyWMS(evalscript, date, opts = {}) {
  refreshAtlasConfig();
  if (wmsLayer) { map.removeLayer(wmsLayer); wmsLayer = null; }
  if (!evalscript) return;

  pendingTiles = 0;
  const encoded = encodeScript(evalscript);
  const { timeStr, windowDays } = getTimeWindow(date);
  const layerName = opts.layer || atlasConfig.wmsLayer;

  updateWindowDisplay(date, windowDays);
  setTileStatus('');

  wmsLayer = new FetchWMS(atlasConfig.wmsUrl, {
    pane: 'atlasWmsPane',
    layers: layerName,
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    time: timeStr,
    maxcc: state.maxcc,
    showlogo: false,
    evalscript: encoded,
    opacity: state.opacity,
    attribution: 'Copernicus Sentinel Hub',
    tileSize: 512,
    minZoom: opts.minZoom != null ? opts.minZoom : 10,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 0,
    maxConcurrent: 1,
    retries: 1,
    retryDelay: 10000,
  });
  watchTileBatch(wmsLayer, layerName);
  wmsLayer.addTo(map);
  applyCaptureComparison();
}

function applyAtlasTiles(idx, date) {
  refreshAtlasConfig();
  const opts = { layer: getWmsCarrierLayer(idx), minZoom: idx.minZoom };
  if (isGeeProvider()) {
    applyGEE(idx, date, opts);
    updateAtlasSentinelUI();
    return;
  }

  const guardStatus = getAtlasSentinelGuardStatus();
  if (guardStatus.blocked) {
    if (wmsLayer) { map.removeLayer(wmsLayer); wmsLayer = null; }
    pendingTiles = 0;
    updateWindowDisplay(date, state.windowDays);
    updateAtlasSentinelUI();
    syncCaptureControls();
    if (guardStatus.reason === 'zoom') {
      setTileStatus(`Sentinel guarded below Z${guardStatus.minZoom}. Zoom in or lower the Sentinel zoom gate.`, 'info');
    } else if (guardStatus.reason === 'cooldown') {
      const seconds = Math.max(1, Math.ceil((guardStatus.until - Date.now()) / 1000));
      setTileStatus(`Sentinel Hub cooling down ${seconds}s after rate limit.`, 'info');
    } else {
      setTileStatus('Sentinel WMS is disarmed. Toggle Sentinel on to request live tiles.', 'info');
    }
    return;
  }

  applyWMS(getDisplayEvalscript(idx), date, opts);
  updateAtlasSentinelUI();
}

function selectIndex(key) {
  const idx = ATLAS_INDICES.find(i => i.key === key);
  if (!idx) return;

  activeKey = key;

  // Highlight active button
  document.querySelectorAll('.atlas-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-key="${key}"]`);
  if (btn) {
    btn.classList.add('active');
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  updateBookmarkFocusMarkers();

  // Navigate to bookmark
  const bm = idx.bookmark;
  state.date = bm.date;
  const dateInputEl = document.getElementById('date-input');
  if (dateInputEl) {
    // The curated bookmark date may not survive AOI-based Sentinel-date filtering; if the dropdown
    // has no option for it, show the nearest date it does have instead of leaving it blank.
    const hasOption = !!dateInputEl.querySelector(`option[value="${bm.date}"]`);
    dateInputEl.value = hasOption ? bm.date : (closestAtlasDateValue(bm.date, state.validSentinelDates) || bm.date);
  }

  map.setView([bm.lat, bm.lng], bm.zoom, { animate: true });

  // Apply WMS (evalscript or TC fallback shown transparently).
  // When paused, skip the tile request entirely so panning/browsing is free.
  if (state.paused) {
    if (wmsLayer) { map.removeLayer(wmsLayer); wmsLayer = null; }
    updateWindowDisplay(bm.date, state.windowDays);
    setTileStatus('Tiles paused — click “▶ Render here” to draw this index.', 'info');
    syncCaptureControls();
  } else {
    applyAtlasTiles(idx, bm.date);
  }
  const note = document.getElementById('sensor-note');
  note.textContent = sensorNote(idx);
  note.className = `cov-note cov-note--${coverageTier(idx)}`;

  // Update legend
  const grad = document.getElementById('legend-gradient');
  grad.style.background = idx.gradient || 'linear-gradient(to right, #111, #fff)';
  document.getElementById('legend-label').textContent = idx.acronym;
  const nameLabel = document.getElementById('legend-name-label');
  if (nameLabel) nameLabel.textContent = idx.name || '';
  updateLegendMetadata();
  const scale = Array.isArray(idx.legend) && idx.legend.length === 2 ? idx.legend : ['Low', 'High'];
  document.getElementById('legend-low').textContent = scale[0];
  document.getElementById('legend-high').textContent = scale[1];

  // Update info panel
  document.getElementById('info-acronym').textContent = idx.acronym;
  document.getElementById('info-name').textContent = idx.name;
  document.getElementById('info-platform').textContent = idx.platform;
  document.getElementById('info-novelty').textContent = isDemo(idx)
    ? 'DEMO'
    : `${idx.contribution || 'C1'} · ${idx.maturity || 'M1'}`;
  const capability = capabilityFor(idx);
  const role = methodRoleMeta(idx);
  document.getElementById('info-capability').textContent = capability?.label || 'Operational sensor demonstration';
  document.getElementById('info-method-role').textContent = isDemo(idx)
    ? 'Demonstration outside the 91-method catalog'
    : `${role.label} — ${role.description}`;
  renderEvidencePanel(idx);
  document.getElementById('info-bands').textContent = bandsLabel(idx);
  document.getElementById('info-formula').textContent = idx.formula;
  document.getElementById('info-formula-status').textContent = idx.formulaStatus || 'Established sensor demonstration';
  document.getElementById('info-validation-status').textContent = idx.validationStatus || 'Pipeline demonstration; no performance claim';
  document.getElementById('info-article-status').textContent = idx.articleSuitability || 'Sensor demonstrator';
  document.getElementById('info-scene-timing').textContent = idx.acquisitionTimestamp
    ? `Bookmark window ends ${bm.date}; representative acquisition ${idx.acquisitionTimestamp} (${idx.acquisitionCloudCover} cloud).`
    : `Bookmark window ends ${bm.date}. Resolve the exact acquisition timestamp from CDSE STAC when capturing an article image.`;
  document.getElementById('info-physics').textContent = idx.physics;
  document.getElementById('info-benefit').textContent = idx.benefit;
  renderAuthorshipClaim(idx);
  renderLinkedInGroundTruth(idx);
  renderCaptureOverlay(idx);
  document.getElementById('info-bookmark').textContent =
    `📍 ${bm.label} · ${bm.date}`;

  const eventEvidenceStatus = idx.eventEvidenceStatus || 'Reviewed display context; not performance evidence';
  document.getElementById('info-justification').textContent = idx.canRender
    ? `${eventEvidenceStatus}. ${bm.label || 'Reviewed display location'} is retained for visual inspection only.`
    : `${eventEvidenceStatus}. ${bm.label || 'Representative location'} is retained to make the proposed use case inspectable.`;

  // Info-panel height can change with the new content — keep the legend clear of it.
  positionLegend();
}

// Draw the active index at the current view/date (incurs provider tile usage).
function renderActive() {
  if (!activeKey) return;
  const idx = ATLAS_INDICES.find(i => i.key === activeKey);
  if (idx) applyAtlasTiles(idx, state.date);
}

// Control-change refresh (date/cloud/window) — suppressed while paused.
function refreshTiles() {
  if (state.paused) return;
  renderActive();
}

function setPauseButton() {
  const btn = document.getElementById('toggle-pause');
  if (!btn) return;
  if (state.paused) {
    btn.textContent = '▶ Render here';
    btn.classList.add('armed');
    btn.title = 'Draw the active index at the current view';
  } else {
    btn.textContent = '⏸ Pause tiles';
    btn.classList.remove('armed');
    btn.title = 'Pause tiles to pan and zoom without provider requests';
  }
}

// Family-first navigation separates a physical/decision capability from the
// multiple methods that can support it. Domain navigation remains available as
// a secondary lens, and future/retired methods move to a dedicated research view.
const TIER_RANK = { live: 0, pending: 1, sensor: 2 };
const CONTRIBUTION_RANK = { C1: 0, C2: 1, C3: 2, DEMO: 3 };
const METHOD_ROLE_RANK = {
  primary: 0,
  reference: 1,
  variant: 2,
  component: 3,
  'research-model': 4,
  retired: 5,
};

const DEMO_CAPABILITY = {
  id: 'operational-demos',
  label: 'Operational Sensor Demos',
  icon: '⊙',
  description: 'Established Sentinel-1 and Sentinel-5P demonstrations kept outside the 91-method research catalog.',
};

function methodRoleFor(idx) {
  return isDemo(idx) ? 'reference' : (idx.methodRole || 'research-model');
}

function methodRoleMeta(idx) {
  const role = methodRoleFor(idx);
  return ATLAS_METHOD_ROLES[role] || { label: role, description: '' };
}

function capabilityFor(idx) {
  if (isDemo(idx)) return DEMO_CAPABILITY;
  return ATLAS_CAPABILITIES.find(capability => capability.id === idx.capability) || null;
}

function sidebarSort(a, b) {
  if (state.sidebarMode !== 'domains') {
    const role = (METHOD_ROLE_RANK[methodRoleFor(a)] ?? 9) - (METHOD_ROLE_RANK[methodRoleFor(b)] ?? 9);
    if (role !== 0) return role;
  }
  const t = TIER_RANK[coverageTier(a)] - TIER_RANK[coverageTier(b)];
  if (t !== 0) return t;
  const contribution = (CONTRIBUTION_RANK[a.contribution] ?? 9) - (CONTRIBUTION_RANK[b.contribution] ?? 9);
  if (contribution !== 0) return contribution;
  return a.acronym.localeCompare(b.acronym);
}

function sidebarGroups() {
  if (state.sidebarMode === 'domains') {
    return ATLAS_DOMAINS.map(domain => ({
      ...domain,
      indices: ATLAS_INDICES.filter(index => index.domain === domain.id),
    }));
  }

  const roleFilter = state.sidebarMode === 'research'
    ? role => role === 'research-model' || role === 'retired'
    : role => role !== 'research-model' && role !== 'retired';
  const capabilityGroups = ATLAS_CAPABILITIES.map(capability => ({
    ...capability,
    indices: NOVEL_INDICES.filter(index => index.capability === capability.id && roleFilter(methodRoleFor(index))),
  }));

  if (state.sidebarMode === 'capabilities') {
    capabilityGroups.push({
      ...DEMO_CAPABILITY,
      indices: ATLAS_INDICES.filter(isDemo),
    });
  }
  return capabilityGroups;
}

function buildSidebar() {
  const container = document.getElementById('domain-list');
  container.replaceChildren();

  for (const group of sidebarGroups()) {
    const indices = [...group.indices].sort(sidebarSort);
    if (!indices.length) continue;

    const section = document.createElement('div');
    section.className = 'domain-section';
    section.dataset.group = group.id;

    const header = document.createElement('button');
    header.className = 'domain-header';
    const liveCount = indices.filter(index => index.canRender).length;
    header.innerHTML = `
      <span class="domain-icon">${group.icon}</span>
      <span class="domain-label">${group.label}</span>
      ${liveCount ? `<span class="domain-live">${liveCount} live</span>` : ''}
      <span class="domain-count">${indices.length}</span>
    `;
    header.title = group.description || group.label;
    header.addEventListener('click', () => {
      section.classList.toggle('collapsed');
    });

    const body = document.createElement('div');
    body.className = 'domain-body';

    for (const idx of indices) {
      const tier = coverageTier(idx);
      const role = methodRoleFor(idx);
      const roleMeta = methodRoleMeta(idx);
      const btn = document.createElement('button');
      btn.className = `atlas-btn cov-${tier} role-${role}`;
      btn.dataset.key = idx.key;
      if (!idx.canRender) btn.classList.add('stub');

      btn.innerHTML = `
        <span class="btn-acronym"><span class="cov-dot cov-dot--${tier}"></span>${idx.acronym}</span>
        <span class="btn-meta">
          <span class="btn-platform">${tierTag(idx)}</span>
          <span class="btn-role role-badge-${role}">${isDemo(idx) ? 'DEMO' : roleMeta.label}</span>
        </span>
      `;
      btn.title = `${idx.name} — ${roleMeta.description} ${tier === 'live' ? 'Live screening proxy.' : tier === 'pending' ? 'Executable or calibration work; not live.' : 'Formula/workflow specification only.'}`;
      btn.addEventListener('click', () => selectIndex(idx.key));
      body.appendChild(btn);
    }

    section.appendChild(header);
    section.appendChild(body);
    container.appendChild(section);
  }

  document.querySelectorAll('[data-sidebar-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.sidebarMode === state.sidebarMode);
    button.setAttribute('aria-pressed', button.dataset.sidebarMode === state.sidebarMode ? 'true' : 'false');
  });

  applySidebarSearch();
  if (activeKey) {
    const activeButton = document.querySelector(`.atlas-btn[data-key="${activeKey}"]`);
    if (activeButton) activeButton.classList.add('active');
  }
}

function applySidebarSearch() {
  const search = document.getElementById('idx-search');
  const q = normalizeSearchText(search?.value || '');
  document.querySelectorAll('.domain-section').forEach(section => {
    let visible = 0;
    section.querySelectorAll('.atlas-btn').forEach(btn => {
      const idx = ATLAS_INDICES.find(index => index.key === btn.dataset.key);
      if (!idx) return;
      const domain = ATLAS_DOMAINS.find(candidate => candidate.id === idx.domain);
      const capability = capabilityFor(idx);
      const role = methodRoleMeta(idx);
      const searchable = [
        idx.key,
        idx.acronym,
        idx.name,
        idx.domain,
        domain?.label,
        idx.capability,
        capability?.label,
        capability?.description,
        methodRoleFor(idx),
        role.label,
        idx.platform,
        idx.platformShort,
      ].map(normalizeSearchText).join(' ');
      const match = !q || searchable.includes(q);
      btn.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    section.style.display = visible ? '' : 'none';
    if (q && visible) section.classList.remove('collapsed');
  });
}

// Lift the legend to sit just above the info panel when it's open, so both are
// visible at once; otherwise let it fall back to its default bottom (CSS).
function positionLegend() {
  const legend = document.querySelector('.atlas-legend');
  const info = document.getElementById('info-panel');
  if (!legend || !info) return;
  if (state.captureMode) {
    legend.style.bottom = '';
    return;
  }
  if (info.classList.contains('hidden')) {
    legend.style.bottom = '';
  } else {
    legend.style.bottom = `${info.offsetHeight + 14}px`;
  }
}

function updateWindowDisplay(date, windowDays) {
  const el = document.getElementById('date-window-display');
  if (!el) return;
  const end = new Date(date);
  const start = new Date(end.getTime() - windowDays * 86400000);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  el.textContent = `📅 ${fmt(start)} → ${fmt(end)}`;
}

// Populate the coverage summary + About panel counts from live catalog data,
// so the figures stay correct as indices are reclassified.
function buildAboutPanel() {
  const c = coverageCounts();
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const catalogTotal = c.live + c.pending + c.sensor;
  set('coverage-summary', `${ATLAS_CAPABILITIES.length} families · ${catalogTotal} methods · ${c.live} live`);
  set('about-count-families', ATLAS_CAPABILITIES.length);
  set('about-count-live', c.live);
  set('about-count-pending', c.pending);
  set('about-count-sensor', c.sensor);
  set('about-count-demo', c.demo);

  // Contribution-type tally over the 91 proposed specifications.
  const contribution = { C1: 0, C2: 0, C3: 0 };
  for (const i of ATLAS_INDICES) {
    if (isDemo(i)) continue;
    if (contribution[i.contribution] != null) contribution[i.contribution]++;
  }
  set('about-nov-t1', `· ${contribution.C1}`);
  set('about-nov-t2', `· ${contribution.C2}`);
  set('about-nov-t3', `· ${contribution.C3}`);

  const roles = { primary: 0, variant: 0, component: 0, reference: 0, 'research-model': 0, retired: 0 };
  for (const index of NOVEL_INDICES) roles[methodRoleFor(index)]++;
  for (const [role, count] of Object.entries(roles)) set(`about-role-${role}`, count);
}

function initMap() {
  BASE_TILES = {
    esri: L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri WorldImagery', maxZoom: 20 }
    ),
    osm: L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }
    )
  };

  map = L.map('atlas-map', {
    center: [20, 0],
    zoom: 3,
    zoomControl: false,
    attributionControl: true
  });

  BASE_TILES[state.base].addTo(map);

  map.createPane('atlasBookmarkFocusPane');
  map.getPane('atlasBookmarkFocusPane').style.zIndex = 575;

  map.createPane('atlasWmsPane');
  map.getPane('atlasWmsPane').style.zIndex = 350;

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  map.on('zoomend', () => {
    updateAtlasSentinelUI();
    if (isSentinelProvider() && !state.paused && activeKey) renderActive();
  });

  map.on('move', () => {
    if (state.captureMode && state.captureView === 'mirror' && mapMirror) {
      mapMirror.setView(map.getCenter(), map.getZoom(), { animate: false });
    }
    if (state.captureMode && state.captureView === 'split') {
      applyCaptureComparison();
    }
    if (state.captureMode && !state.captureInfoCollapsed) {
      updateCaptureInfoBox();
    }
    updateLegendMetadata();
  });

  map.on('viewreset', () => {
    if (state.captureMode && state.captureView === 'mirror' && mapMirror) {
      mapMirror.setView(map.getCenter(), map.getZoom(), { animate: false });
    }
    if (state.captureMode && state.captureView === 'split') {
      applyCaptureComparison();
    }
    if (state.captureMode && !state.captureInfoCollapsed) {
      updateCaptureInfoBox();
    }
    updateLegendMetadata();
  });

  map.on('moveend', () => {
    setTimeout(() => probeAtlasAcquisitions(), 1600);
  });

  // Base layer toggle
  document.getElementById('toggle-base').addEventListener('click', () => {
    const keys = Object.keys(BASE_TILES);
    const next = keys[(keys.indexOf(state.base) + 1) % keys.length];
    map.removeLayer(BASE_TILES[state.base]);
    state.base = next;
    BASE_TILES[state.base].addTo(map);
    document.getElementById('toggle-base').textContent =
      next === 'esri' ? '🛰 Satellite' : '🗺 Map';
  });
}

function initControls() {
  syncAtlasSentinelState();
  updateAtlasSentinelUI();

  // Date select (unfiltered until the first catalog probe resolves)
  const dateInput = document.getElementById('date-input');
  populateAtlasDateOptions(dateInput, null);
  dateInput.value = state.date;
  dateInput.addEventListener('change', () => {
    state.date = dateInput.value;
    refreshTiles();
  });

  // Opacity slider
  const opSlider = document.getElementById('opacity-slider');
  opSlider.value = state.opacity;
  opSlider.addEventListener('input', () => {
    state.opacity = parseFloat(opSlider.value);
    if (state.captureMode) {
      applyCaptureComparison();
    } else if (wmsLayer) {
      wmsLayer.setOpacity(state.opacity);
    }
  });

  // Family/domain/research navigation
  document.querySelectorAll('[data-sidebar-mode]').forEach(button => {
    button.addEventListener('click', () => {
      state.sidebarMode = button.dataset.sidebarMode;
      buildSidebar();
    });
  });

  // Search filter
  const search = document.getElementById('idx-search');
  search.addEventListener('input', applySidebarSearch);

  // Go to manually entered coordinates
  const coordInput = document.getElementById('atlas-coord-input');
  const coordGoBtn = document.getElementById('atlas-coord-go');
  const coordRegex = /^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/;

  const handleCoordGo = () => {
    const query = coordInput.value.trim();
    const match = query.match(coordRegex);
    const lat = match ? parseFloat(match[1]) : NaN;
    const lng = match ? parseFloat(match[2]) : NaN;

    if (!match || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      coordInput.classList.add('is-invalid');
      return;
    }
    coordInput.classList.remove('is-invalid');

    map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 1.5 });

    if (coordMarker) map.removeLayer(coordMarker);
    coordMarker = L.circleMarker([lat, lng], {
      radius: 9,
      color: '#fff',
      weight: 2,
      fillColor: '#00D2FF',
      fillOpacity: 0.9,
      className: 'pulse-marker'
    }).addTo(map);
    coordMarker.bindTooltip(`${lat.toFixed(5)}, ${lng.toFixed(5)}`, {
      direction: 'top',
      opacity: 0.95
    });
  };

  coordGoBtn.addEventListener('click', handleCoordGo);
  coordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCoordGo();
  });
  coordInput.addEventListener('input', () => coordInput.classList.remove('is-invalid'));

  // Cloud cover slider
  const maxccSlider = document.getElementById('maxcc-slider');
  const maxccValue = document.getElementById('maxcc-value');
  maxccSlider.value = state.maxcc;
  maxccSlider.addEventListener('input', () => {
    state.maxcc = parseInt(maxccSlider.value, 10);
    maxccValue.textContent = `${state.maxcc}%`;
    refreshTiles();
  });

  // Date window pills
  document.querySelectorAll('.window-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.windowDays = parseInt(pill.dataset.days, 10);
      document.querySelectorAll('.window-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      refreshTiles();
    });
  });

  // Pause tiles — drop the provider overlay so pan/zoom uses zero tile requests.
  // Toggling back ("Render here") redraws the active index at the current view.
  setPauseButton();
  document.getElementById('toggle-pause').addEventListener('click', () => {
    if (!state.paused) {
      state.paused = true;
      if (wmsLayer) { map.removeLayer(wmsLayer); wmsLayer = null; }
      setTileStatus('Tiles paused — pan and zoom freely without provider tile requests. Click “▶ Render here” to draw the active index.', 'info');
      syncCaptureControls();
    } else {
      state.paused = false;
      setTileStatus('');
      renderActive();
    }
    setPauseButton();
  });

  updateBookmarkFocusButton();
  const bookmarkFocusToggle = document.getElementById('toggle-bookmark-focus');
  if (bookmarkFocusToggle) {
    bookmarkFocusToggle.addEventListener('click', () => {
      setBookmarkFocusVisible(!state.bookmarkFocusVisible);
    });
  }

  const captureToggle = document.getElementById('toggle-capture');
  if (captureToggle) {
    captureToggle.addEventListener('click', () => {
      setCaptureMode(!state.captureMode);
    });
  }

  const exitCapture = document.getElementById('exit-capture');
  if (exitCapture) {
    exitCapture.addEventListener('click', () => {
      setCaptureMode(false);
    });
  }

  document.querySelectorAll('.capture-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setCaptureView(btn.dataset.captureView);
    });
  });

  const captureSplitSlider = document.getElementById('capture-split-slider');
  if (captureSplitSlider) {
    captureSplitSlider.value = String(state.captureSplit);
    captureSplitSlider.addEventListener('input', (event) => {
      state.captureSplit = Number(event.target.value);
      applyCaptureComparison();
    });
  }

  const captureSaveBtn = document.getElementById('capture-save-btn');
  if (captureSaveBtn) {
    captureSaveBtn.addEventListener('click', () => saveCapturePng());
  }

  const captureOpacitySlider = document.getElementById('capture-opacity-slider');
  if (captureOpacitySlider) {
    captureOpacitySlider.value = String(state.captureOpacity);
    captureOpacitySlider.addEventListener('input', () => {
      state.captureOpacity = parseFloat(captureOpacitySlider.value);
      applyCaptureComparison();
    });
  }

  const captureTipToggle = document.getElementById('capture-tip-toggle');
  if (captureTipToggle) {
    captureTipToggle.addEventListener('click', () => {
      const prompt = document.getElementById('capture-prompt');
      if (!prompt) return;
      const open = prompt.classList.toggle('visible');
      captureTipToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  const captureCollapseBtn = document.getElementById('capture-collapse-btn');
  if (captureCollapseBtn) {
    captureCollapseBtn.addEventListener('click', () => {
      state.captureCardCollapsed = !state.captureCardCollapsed;
      syncCaptureCardCollapse();
    });
  }

  const captureInfoCollapseBtn = document.getElementById('capture-info-collapse-btn');
  if (captureInfoCollapseBtn) {
    captureInfoCollapseBtn.addEventListener('click', () => {
      state.captureInfoCollapsed = true;
      syncCaptureInfoBox();
    });
  }

  const captureInfoTrigger = document.getElementById('capture-info-trigger');
  if (captureInfoTrigger) {
    captureInfoTrigger.addEventListener('click', () => {
      state.captureInfoCollapsed = false;
      syncCaptureInfoBox();
    });
  }

  const sentinelToggle = document.getElementById('atlas-toggle-sentinel-live');
  if (sentinelToggle) {
    sentinelToggle.addEventListener('change', (event) => {
      if (event.target.checked) {
        runtimeAtlasImageProviderOverride = 'sentinelhub';
        state.sentinelLiveTiles = true;
        state.sentinelRateLimitedUntil = 0;
      } else {
        if (runtimeAtlasImageProviderOverride === 'sentinelhub') runtimeAtlasImageProviderOverride = null;
        state.sentinelLiveTiles = false;
        state.sentinelRateLimitedUntil = 0;
      }
      refreshAtlasConfig();
      updateAtlasSentinelUI();
      if (!state.paused) renderActive();
    });
  }

  const sentinelSource = document.getElementById('atlas-sentinel-source');
  if (sentinelSource) {
    sentinelSource.addEventListener('change', (event) => {
      runtimeAtlasWmsSource = event.target.value;
      state.sentinelRateLimitedUntil = 0;
      refreshAtlasConfig();
      updateAtlasSentinelUI();
      if (isSentinelProvider() && !state.paused) renderActive();
    });
  }

  const sentinelZoom = document.getElementById('atlas-sentinel-min-zoom');
  if (sentinelZoom) {
    sentinelZoom.value = String(state.sentinelMinZoom);
    sentinelZoom.addEventListener('input', (event) => {
      state.sentinelMinZoom = Number(event.target.value);
      updateAtlasSentinelUI();
    });
    sentinelZoom.addEventListener('change', () => {
      updateAtlasSentinelUI();
      if (isSentinelProvider() && !state.paused) renderActive();
    });
  }

  // Info toggle — keep the legend visible by lifting it above the info panel
  document.getElementById('toggle-info').addEventListener('click', () => {
    document.getElementById('info-panel').classList.toggle('hidden');
    positionLegend();
  });
  window.addEventListener('resize', positionLegend);
  let _frameGuideResizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_frameGuideResizeTimer);
    _frameGuideResizeTimer = setTimeout(updateCaptureFrameGuide, 100);
  });

  // Info panel resize handle
  const infoPanel = document.getElementById('info-panel');
  const resizeHandle = document.getElementById('info-resize-handle');
  if (infoPanel && resizeHandle) {
    let dragStartY = 0;
    let dragStartH = 0;
    resizeHandle.addEventListener('mousedown', (e) => {
      dragStartY = e.clientY;
      dragStartH = infoPanel.offsetHeight;
      resizeHandle.classList.add('dragging');
      document.body.style.userSelect = 'none';
      const onMove = (ev) => {
        const delta = dragStartY - ev.clientY;
        const next = Math.max(80, Math.min(window.innerHeight * 0.75, dragStartH + delta));
        infoPanel.style.setProperty('--info-panel-h', `${next}px`);
        positionLegend();
      };
      const onUp = () => {
        resizeHandle.classList.remove('dragging');
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  const copyLinkedIn = document.getElementById('copy-linkedin-ground-truth');
  if (copyLinkedIn) {
    copyLinkedIn.addEventListener('click', async () => {
      if (!currentLinkedInGroundTruthDraft) return;
      try {
        await navigator.clipboard.writeText(currentLinkedInGroundTruthDraft);
        copyLinkedIn.textContent = 'Copied';
        window.setTimeout(() => { copyLinkedIn.textContent = 'Copy draft'; }, 1600);
      } catch {
        copyLinkedIn.textContent = 'Copy failed';
        window.setTimeout(() => { copyLinkedIn.textContent = 'Copy draft'; }, 1600);
      }
    });
  }

  // About / coverage overlay
  const aboutOverlay = document.getElementById('about-overlay');
  const openAbout = () => aboutOverlay.classList.remove('hidden');
  const closeAbout = () => aboutOverlay.classList.add('hidden');
  document.getElementById('about-btn').addEventListener('click', openAbout);
  document.getElementById('about-close').addEventListener('click', closeAbout);
  aboutOverlay.addEventListener('click', (e) => {
    if (e.target === aboutOverlay) closeAbout(); // click backdrop to dismiss
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !aboutOverlay.classList.contains('hidden')) closeAbout();
  });
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function applyUrlHashState() {
  const hash = String(window.location.hash || '').replace(/^#/, '');
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const targetKey = params.get('lens') || params.get('index') || params.get('id') || params.get('key');
  if (targetKey) {
    const idx = ATLAS_INDICES.find(item =>
      item.key.toLowerCase() === targetKey.toLowerCase() ||
      item.acronym.toLowerCase() === targetKey.toLowerCase()
    );
    if (idx) selectIndex(idx.key);
  }

  const lat = parseFloat(params.get('lat'));
  const lng = parseFloat(params.get('lng'));
  const zoom = parseInt(params.get('zoom'), 10);
  if (!isNaN(lat) && !isNaN(lng) && map) {
    map.setView([lat, lng], !isNaN(zoom) ? zoom : (map.getZoom() || 11));
  }

  const date = params.get('date');
  if (date) {
    const select = document.getElementById('atlas-date-select');
    if (select) {
      select.value = date;
      state.date = date;
      refreshTiles();
    }
  }
}

export async function initAtlas() {
  initMap();
  buildSidebar();
  buildAboutPanel();
  initControls();

  // Auto-select first renderable index
  const first = ATLAS_INDICES.find(i => i.canRender);
  if (first) selectIndex(first.key);

  // Apply deep-link URL hash parameters if present
  applyUrlHashState();
  window.addEventListener('hashchange', applyUrlHashState);
}
