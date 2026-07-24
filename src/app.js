/* ==========================================================================
   Limn - Core Logic (ES Module Entry Point)
   ========================================================================== */

import { getCDSEToken } from './auth.js';

import { 
    INDICES, 
    CALIBRATION_PRESETS, 
    genEvalscript, 
    genDiffEvalscript, 
    genCumulativeEvalscript,
    colorBlend,
    PALETTE_NDMI,
    PALETTE_NDWI,
    PALETTE_VEG,
    PALETTE_MSI,
    PALETTE_BRINE,
    PALETTE_CSI,
    PALETTE_HCAI,
    PALETTE_HMRI,
    PALETTE_PWI,
    PALETTE_BSI,
    PALETTE_REAI,
    PALETTE_VCBI,
    PALETTE_FBC,
    PALETTE_HPWI,
    PALETTE_LBI,
    PALETTE_TRI,
    PALETTE_BPI,
    PALETTE_VSI,
    PALETTE_CMA,
    PALETTE_PHI,
    PALETTE_HMI,
    PALETTE_SCRI,
    PALETTE_MSI_INV,
    CHART_COLORS
} from './indices.js';
import {
    detectPeakAnomaly,
    showHoverHighlight,
    getDrawnWKT,
    buildHighlightUrl,
    renderScanThumbnails,
    prefetchHighlights,
    hideHoverHighlight
} from './charts.js';
import {
    probeAcquisitions as probeAcquisitionsFromReport,
    openReportModal,
    closeReportModal,
    initRrcSpillOverlay,
    downloadHTMLReport
} from './report.js?v=78';
import {
    initLeafletMap,
    applyIndex as applyIndexDelegate,
    updateGifInset as updateGifInsetDelegate,
    getScriptContent,
    getImageryProvider,
    getIndexLayer
} from './map.js?v=78';
import {
    showToast as showToastDelegate,
    switchTab,
    updateUI as updateUIDelegate
} from './ui.js?v=78';
import { buildSpillEvidenceTimeline } from './evidence-timeline.js';

const AOI_LOCATIONS = {
    dixon: { lat: 31.893285, lng: -101.864031, zoom: 15 },
    rocker: { lat: 31.244621, lng: -101.261754, zoom: 15 },
    sweatt: { lat: 31.480407, lng: -103.423865, zoom: 15 }
};

// Confirmed produced water spill incidents — all sourced from TRRC, NMED, or news.
// Coordinates are approximate (derived from geographic anchors, not survey data).
const SPILL_BOOKMARKS = [
    {
        id: 'lake-boehmer-pecos-orphan',
        label: 'Lake Boehmer (Imperial, TX)',
        date: '2026-01-01',
        displayDate: 'Continuous',
        lat: 31.226, lng: -102.729, zoom: 14,
        volume: 'Chronic Brine Lake (60+ acres)',
        source: 'Wikipedia / Marfa Public Radio',
        sourceUrl: 'https://texasstandard.org/stories/lake-boehmer-toxic-water-oil-well-leak/',
        sourceUrls: [
            'https://texasstandard.org/stories/lake-boehmer-toxic-water-oil-well-leak/',
            'https://mapcarta.com/W461021594'
        ],
        evidenceClass: 'chronic-brine-positive',
        eventDate: 'continuous since ~2003',
        dateRole: 'representative continuous imagery date',
        confidence: 'High (Exact GPS)',
        note: 'Representative chronic-standing-water context. This 60-acre saline lake in Pecos County is associated with a legacy oil well. Inspect True Color, MNDWI/AWEI, SWIR context, and LBI together; a visible response documents surface-water context, not brine chemistry or produced-water specificity. PWCI, ASAI, and OBEC are retained only for negative-result comparison.',
        indices: ['tc', 'ndwi', 'awei', 'swir_rgb', 'lbi'],
    },
    {
        id: 'meister-2022',
        label: 'Meister Ranch Geyser',
        date: '2022-01-02',
        displayDate: 'Jan 2022',
        lat: 31.3826, lng: -102.6171, zoom: 15,
        volume: '~357,000 bbl over 14 days',
        source: 'TRRC / Karanam et al. 2024 (GRL)',
        sourceUrl: 'https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2024GL109435',
        sourceUrls: [
            'https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2024GL109435',
            'https://www.firstalert7.com/2022/01/28/rrc-reports-heavy-contamination-crane-county-blowout-source-water-pressure-still-unknown/'
        ],
        evidenceClass: 'produced-water-positive',
        eventDate: '2022-01-02/2022-01-14',
        dateRole: 'event-window imagery date',
        confidence: 'High (Exact GPS)',
        note: 'Documented event-window inspection site for the January 2022 brine geyser. Use True Color, before/after comparison, water/moisture lenses, and LBI as complementary surface context. PWCI and ASAI were blank in reviewed frames; no displayed lens establishes source or chemistry.',
        indices: ['tc', 'ndwi', 'awei', 'ndmi', 'lbi'],
    },
    {
        id: 'crane-crevice-2023',
        label: 'FM 329 Crevice, Crane Co.',
        date: '2023-12-07',
        displayDate: 'Dec 2023',
        lat: 31.370, lng: -102.620, zoom: 14,
        volume: '~14M gallons over 45 days',
        source: 'TRRC / Marfa Public Radio',
        sourceUrl: 'https://www.marfapublicradio.org/environment/2024-02-05/state-spends-millions-to-plug-massive-well-leak-in-the-oil-fields-of-crane-county',
        sourceUrls: [
            'https://www.marfapublicradio.org/environment/2024-02-05/state-spends-millions-to-plug-massive-well-leak-in-the-oil-fields-of-crane-county',
            'https://bigbendsentinel.com/2024/01/10/railroad-commission-claims-gas-leak-to-hide-produced-water-destruction/'
        ],
        evidenceClass: 'produced-water-positive',
        eventDate: '2023-12-07',
        dateRole: 'event start imagery date',
        confidence: 'Medium (~0.5km)',
        note: 'Documented December 2023 event-context site for a large saline-water release and vegetation impact. Use True Color, before/after, water/moisture, vegetation, and SWIR lenses together. LBI may show liquid/salinity response, while PWCI was blank under strict gates; neither result establishes source or chemistry.',
        indices: ['tc', 'ndwi', 'awei', 'ndmi', 'savi', 'ndre', 'swir_rgb', 'lbi'],
    },
    {
        id: 'toyah-2024',
        label: 'Toyah Well Blowout',
        date: '2024-10-02',
        displayDate: 'Oct 2024',
        lat: 31.320, lng: -103.872, zoom: 15,
        volume: 'Active 19 days (volume unquantified)',
        source: 'TRRC / Texas Tribune / DeSmog',
        sourceUrl: 'https://www.texastribune.org/2024/10/22/west-texas-well-blowout-oil-gas-sealed/',
        sourceUrls: [
            'https://www.texastribune.org/2024/10/22/west-texas-well-blowout-oil-gas-sealed/',
            'https://www.desmog.com/2024/10/04/texas-railroad-commission-kinder-morgan-oil-well-blowout-erupts-in-west-texas-permian-basin/'
        ],
        evidenceClass: 'produced-water-positive',
        eventDate: '2024-10-02',
        dateRole: 'event start date',
        confidence: 'Medium (~1km)',
        note: '100-ft geyser of oily saline brine + H2S gas from a 1961 dry hole, requiring local emergency response. Current proof/support targets: OBEC gives the clearest pad-scale signal and LBI shows liquid-brine response; PWCI stays blank under strict gates.',
        indices: ['hpwi', 'lbi'],
    },
    {
        id: 'apache-balmorhea-2020',
        label: 'Apache Corp. Balmorhea Spill',
        date: '2021-01-01',
        displayDate: 'Jul 2020',
        lat: 31.130, lng: -103.745, zoom: 13,
        volume: '77,500 BBL Produced Water',
        source: 'TRRC / Inside Climate News',
        sourceUrl: 'https://texasstandard.org/stories/oil-and-gas-companies-spill-millions-of-gallons-of-wastewater-in-texas/',
        sourceUrls: [
            'https://texasstandard.org/stories/oil-and-gas-companies-spill-millions-of-gallons-of-wastewater-in-texas/'
        ],
        evidenceClass: 'produced-water-context',
        eventDate: '2020-07-29',
        dateRole: 'post-event residue imagery date',
        confidence: 'Medium (~1km)',
        note: 'Context-only bookmark. Massive produced water storage tank battery blowout north of Balmorhea. The current baseline found only weak broad residue/facility signal, so this is retained for source context rather than proof-grade index validation.',
        indices: [],
    },
    {
        id: 'antina-ranch-2021',
        label: 'Antina Ranch (Chevron Estes)',
        date: '2021-06-17',
        displayDate: 'Jun 2021',
        lat: 31.50, lng: -102.85, zoom: 13,
        volume: 'Chronic Leaking Brine + Methane',
        source: 'TRRC / Inside Climate News',
        sourceUrl: 'https://www.firstalert7.com/2021/06/17/abandoned-chevron-well-springs-leak-leaves-one-rancher-demanding-answers/',
        sourceUrls: [
            'https://www.firstalert7.com/2021/06/17/abandoned-chevron-well-springs-leak-leaves-one-rancher-demanding-answers/',
            'https://texasstandard.org/stories/west-texas-permian-basin-abondoned-orphan-oil-gas-wells-leaking/'
        ],
        evidenceClass: 'produced-water-context',
        eventDate: '2021-06-17',
        dateRole: 'documented report date',
        confidence: 'Regional (±10km)',
        note: 'Context-only regional bookmark. Orphaned wells on Crane/Ward County ranch leaked highly saline wastewater and gas. Loop review found OBEC/LBI context signal, but the source location remains regional rather than proof-grade GPS.',
        indices: ['hpwi', 'lbi'],
    },
    {
        id: 'enlink-midstream-chickadee-2023',
        label: 'Midland Crude Spill (EnLink)',
        date: '2023-03-29',
        displayDate: 'Mar 2023',
        lat: 31.840, lng: -102.078, zoom: 13,
        volume: '9,583 BBL Crude Oil',
        source: 'Pipeline Safety Trust / EPA',
        sourceUrl: 'https://pstrust.org/enlink-midstreams-chickadee-pipeline-ruptured-and-spilled-402486-gallons-of-crude-oil-just-south-of-midland-texas/',
        sourceUrls: [
            'https://pstrust.org/enlink-midstreams-chickadee-pipeline-ruptured-and-spilled-402486-gallons-of-crude-oil-just-south-of-midland-texas/'
        ],
        evidenceClass: 'hydrocarbon-negative-control',
        eventDate: '2023-03-29',
        dateRole: 'event date',
        confidence: 'Medium (~1.5km)',
        note: 'Approximate-location crude-oil event retained as a qualitative cross-material context site. Blank or weak PWCI/ASAI response here does not establish produced-water specificity; the coordinate uncertainty and single event make it unsuitable as a standalone validation control.',
        indices: [],
    },
    {
        id: 'eog-klondike-2025',
        label: 'EOG Klondike Pit, Lea Co. NM',
        date: '2025-07-10',
        displayDate: 'Jun 2025',
        lat: 32.24, lng: -103.57, zoom: 14,
        volume: '~160,000 gal spilled, ~143,000 gal lost',
        source: 'NMED / WildEarth Guardians',
        sourceUrl: 'https://pdf.wildearthguardians.org/support_docs/20250728-Q2-2025-Oil-Gas-Waste-Watch.pdf',
        sourceUrls: [
            'https://pdf.wildearthguardians.org/support_docs/20250728-Q2-2025-Oil-Gas-Waste-Watch.pdf'
        ],
        evidenceClass: 'produced-water-context',
        eventDate: '2025-06-10',
        dateRole: 'post-event context imagery date',
        confidence: 'Regional (±15km)',
        note: 'Context-only regional bookmark. Equipment failure overflow at a produced water reuse pit on New Mexico State Trust Land in Lea County, damaging over 20 acres of high-desert scrub. Current context-support lenses are LBI, OBEC, and ASAI; source precision remains regional rather than proof-grade GPS.',
        indices: ['lbi', 'hpwi', 'pwoi'],
    },
    {
        id: 'oxy-mesa-verde-2025',
        label: 'OXY Mesa Verde East, NM',
        date: '2025-07-15',
        displayDate: 'Jul 2025',
        lat: 32.25, lng: -103.63, zoom: 12,
        volume: '~1.6M gal produced water + 126k gal crude',
        source: 'NMED / WildEarth Guardians',
        sourceUrl: 'https://pdf.wildearthguardians.org/site/DocServer/Q3%202025%20Waste%20Watch%20Report.pdf',
        sourceUrls: [
            'https://pdf.wildearthguardians.org/site/DocServer/Q3%202025%20Waste%20Watch%20Report.pdf'
        ],
        evidenceClass: 'produced-water-context',
        eventDate: '2025-07-15',
        dateRole: 'event date',
        confidence: 'Regional (±5km)',
        note: 'Context-only regional bookmark. Huge wastewater recycling facility failure on federal land in southeast New Mexico. Current context-support lenses are LBI plus moderate OBEC/ASAI; PWCI stays blank.',
        indices: ['lbi', 'hpwi', 'pwoi'],
    },
    {
        id: 'black-river-cimarex-2023',
        label: 'Black River PW Truck Rollover',
        date: '2023-10-03',
        displayDate: 'Oct 2023',
        lat: 32.219252, lng: -104.222885, zoom: 16,
        volume: '65 BBL Produced Water Lost',
        source: 'NMOCD closure report',
        sourceUrl: 'https://ocdimage.emnrd.nm.gov/imaging/Filestore/SantaFe/NF/20250224/nAPP2327753740_02_24_2025_11_30_44.pdf',
        sourceUrls: [
            'https://ocdimage.emnrd.nm.gov/imaging/Filestore/SantaFe/NF/20250224/nAPP2327753740_02_24_2025_11_30_44.pdf'
        ],
        evidenceClass: 'produced-water-context',
        eventDate: '2023-10-03',
        dateRole: 'event date',
        confidence: 'High (Exact GPS)',
        note: 'Cimarex/Coterra closure report documents a third-party truck rollover releasing produced water at the Black River / John D. Forehand Road crossing. The release is small for Sentinel-2, so use OBEC/LBI here as exact-location support context rather than a standalone proof-of-volume claim. Current ASAI is blank after stricter dry-brine gating.',
        indices: ['hpwi', 'lbi'],
    },
    {
        id: 'matador-desoto-spring-2025',
        label: 'Matador Desoto Spring Pond, NM',
        date: '2025-09-21',
        displayDate: 'Sep 2025',
        lat: 32.07605, lng: -103.28241, zoom: 16,
        volume: '6,354 BBL Produced Water',
        source: 'NMOCD NOR / WildEarth Guardians',
        sourceUrl: 'https://ocdimage.emnrd.nm.gov/imaging/filestore/SantaFe/NF/20250921/nAPP2526466779_09_21_2025_06_33_33.pdf',
        sourceUrls: [
            'https://ocdimage.emnrd.nm.gov/imaging/filestore/SantaFe/NF/20250921/nAPP2526466779_09_21_2025_06_33_33.pdf',
            'https://pdf.wildearthguardians.org/site/DocServer/Q3%202025%20Waste%20Watch%20Report.pdf'
        ],
        evidenceClass: 'produced-water-positive',
        eventDate: '2025-09-21',
        dateRole: 'event date',
        confidence: 'High (Facility GPS)',
        note: 'NMOCD notification documents a large Desoto Spring Recycling Pond produced-water release. Loop-reviewed proof defaults: OBEC and LBI produce a sharp pond-scale signal at the documented facility coordinates; PWCI stayed blank.',
        indices: ['hpwi', 'lbi', 'pwoi'],
    },
    {
        id: 'oxy-lea-flowline-2026',
        label: 'OXY Lea Flowline Release',
        date: '2026-05-24',
        displayDate: 'May 2026',
        lat: 32.692986, lng: -103.174825, zoom: 15,
        volume: '942 BBL Produced Water, 412 BBL Lost',
        source: 'NMOCD spill database',
        sourceUrl: 'https://wwwapps.emnrd.nm.gov/OCD/OCDPermitting/Data/Spills/SpillSearchResults.aspx?Ogrid=16696&OperatorSearchClause=ogrid',
        sourceUrls: [
            'https://wwwapps.emnrd.nm.gov/OCD/OCDPermitting/Data/Spills/SpillSearchResults.aspx?Ogrid=16696&OperatorSearchClause=ogrid'
        ],
        evidenceClass: 'produced-water-positive',
        eventDate: '2026-05-24',
        dateRole: 'event date',
        confidence: 'High (Exact NMOCD row)',
        note: 'NMOCD row nAPP2614556829 documents a produced-water release from an injection flowline in Lea County: 942 BBL released and 412 BBL lost. Treat the bookmark as event context: inspect True Color, before/after, moisture/water, bare-soil, and SWIR lenses. Strict PWCI, ASAI, and OBEC are blank or weak in the available scene.',
        indices: ['tc', 'ndmi', 'ndwi', 'bsi', 'swir_rgb', 'lbi'],
    },
    {
        id: 'oxy-sand-dunes-2026',
        label: 'OXY Sand Dunes Water Tank',
        date: '2026-05-06',
        displayDate: 'May 2026',
        lat: 32.24671, lng: -103.78661, zoom: 16,
        volume: '500 BBL Produced Water, 160 BBL Lost',
        source: 'NMOCD spill database',
        sourceUrl: 'https://wwwapps.emnrd.nm.gov/OCD/OCDPermitting/Data/Spills/SpillSearchResults.aspx?Ogrid=16696&OperatorSearchClause=ogrid',
        sourceUrls: [
            'https://wwwapps.emnrd.nm.gov/OCD/OCDPermitting/Data/Spills/SpillSearchResults.aspx?Ogrid=16696&OperatorSearchClause=ogrid'
        ],
        evidenceClass: 'produced-water-context',
        eventDate: '2026-04-21',
        dateRole: 'post-event peak-signal imagery date',
        confidence: 'High (Exact NMOCD row)',
        note: 'NMOCD row nAPP2611452043 documents a major OXY Sand Dunes Water Tank Facility produced-water release in Eddy County: 500 BBL released and 160 BBL lost. Loop review found only a BPI facility/tank signal; this is context, not chemistry proof.',
        indices: ['bpi'],
    },
    {
        id: 'brine-calibration-31892-2025',
        label: 'Brine Calibration Site (Midland Co.)',
        date: '2025-12-01',
        displayDate: 'Dec 2025',
        lat: 31.892457, lng: -101.864001, zoom: 15,
        volume: 'Reported wet brine activity',
        source: 'User-reported observation (calibration target)',
        sourceUrl: '',
        sourceUrls: [],
        evidenceClass: 'produced-water-context',
        eventDate: '2025-11-01/2025-12-31',
        dateRole: 'measured peak-signal imagery date within the reported window',
        confidence: 'User-supplied coordinates; no public filing resolved',
        note: 'Context-only calibration target. User-reported wet brine activity Nov–Dec 2025 over an active Permian oilfield pad cluster. Hotspot-loop measurement (2026-07-24) found pad-scale OBEC signal at 2025-12-01 (coherent but modest, ~1.4% largest component) plus a broad BPI facility/tank response; PWCI, ASAI, and LBI were blank or weak. The OBEC signal is scene/provider dependent — it renders via Sentinel WMS but is faint on the default COG scene — so treat this as facility/surface context for threshold calibration, not proof of a produced-water release. No public regulator filing has been resolved for these coordinates.',
        indices: ['hpwi'],
    }
];

const INDEX_SHORT_LABELS = {
    pwi: 'PWCI', pwoi: 'ASAI', hpwi: 'OBEC', ehc: 'EHC', lbi: 'LBI', bpi: 'BPI', fbc: 'FBC', vsi: 'VSI', mvpi: 'MVPI',
    tc: 'RGB', ndwi: 'MNDWI', ndmi: 'NDMI', savi: 'SAVI', bsi: 'BSI', ndsi: 'SWIR Δ',
    si: 'SI', csi: 'CSI', hcai: 'HCAI', hmri: 'HMRI', ndoi: 'NDOI',
    awei: 'AWEI', ndre: 'NDRE', swir_rgb: 'SWIR RGB', s1_sar: 'S1',
    ksi: 'KSI', vssi: 'VSSI',
};
const DEFAULT_SPILL_ID = 'lake-boehmer-pecos-orphan';
const DEFAULT_INDEX = 'tc';
const COG_PROVIDER_KEYS = new Set(['cog', 'sentinel-cog', 'sentinel2-cog']);
const COG_SUPPORTED_INDEX_KEYS = new Set([
    'none', 'tc', 'truecolor', 'true-color', 'swir_rgb',
    'awei', 'ndre', 'ndmi', 'ndwi', 'ndvi', 'savi', 'bsi', 'ndsi',
    'si', 'csi', 'hcai', 'hmri', 'ndoi', 'ksi', 'vssi',
    'pwi', 'hpwi', 'pwoi', 'lbi'
]);
const COG_SCREEN_INDEX_KEYS = new Set([
    'tc', 'lbi', 'ndwi', 'awei', 'ndmi', 'savi', 'bsi', 'ndsi', 'swir_rgb', 'ndre',
    'si', 'csi', 'hcai', 'hmri', 'ndoi', 'ksi', 'vssi',
    'pwi', 'pwoi', 'hpwi'
]);
const SCREENING_VISIBILITY_INDEX_KEYS = new Set(['pwi', 'hpwi', 'pwoi', 'lbi']);

// Capability badges surfaced on index buttons so a user doesn't have to guess which lens is
// salinity-related and/or part of Limn's dedicated produced-water/brine screening set. Driven by
// each entry's `tags` array in indices.js — see knowledge/DECISIONS.md for how those were assigned.
const CAPABILITY_BADGES = {
    salinity: { icon: '🧂', label: 'Salinity screening hypothesis — not a validated salt-concentration/EC measurement.' },
    'produced-water': { icon: '🛢️', label: "Part of Limn's produced-water/brine screening set — see the info tooltip for validation status." }
};

function capabilityBadgesHTML(tags) {
    if (!Array.isArray(tags) || !tags.length) return '';
    return tags.map(tag => {
        const def = CAPABILITY_BADGES[tag];
        if (!def) return '';
        return `<span class="capability-badge capability-${tag}" data-tooltip="${def.label}" aria-label="${def.label}">${def.icon}</span>`;
    }).join('');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const START_YEAR = 2020;
const ALL_DATES = [];
const today = new Date(); // Reverted to testing current live data
let iterDate = new Date(Date.UTC(START_YEAR, 0, 1));

while (iterDate <= today) {
    let y = iterDate.getUTCFullYear();
    let m = iterDate.getUTCMonth();
    let d = iterDate.getUTCDate();

    let mm = String(m + 1).padStart(2, '0');
    let dd = String(d).padStart(2, '0');

    ALL_DATES.push({
        value: `${y}-${mm}-${dd}`,
        label: `${MONTHS[m]} ${d}, ${y}`,
        short: `${MONTHS[m]} ${d}, '${y.toString().slice(-2)}`,
        displayStr: `${MONTHS[m]} ${d}, ${y}`
    });

    iterDate.setUTCDate(iterDate.getUTCDate() + 1);
}



// Imagery provider configuration.
const SH_WMS_URL = 'https://sh.dataspace.copernicus.eu/ogc/wms/959ea2c5-5892-4b36-82b3-76e6bdb93c8a';
const SH_STAT_API_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';

const APP_VERSION = 'v50';

const internalAppConfig = {
    IMAGE_PROVIDER: 'cog',
    GEE_TILE_ENDPOINT: '/api/gee/tiles',
    COG_TILE_ENDPOINT: '/api/cog/tiles',
    ALLOW_SENTINEL_FALLBACK: false,
    SENTINEL_CREDIT_GUARD: true,
    SENTINEL_LIVE_TILES: false,
    SENTINEL_MIN_ZOOM: 14,
    // The bundled AGRICULTURE WMS layer is Sentinel-2 L1C and has no SCL band.
    // Set true only when SH_WMS_URL/layer points to an L2A configuration.
    SENTINEL_WMS_SUPPORTS_SCL: false,
    SH_WMS_URL,
    SH_STAT_API_URL,
    ALL_DATES,
    INDICES,
    START_YEAR
};
let runtimeImageProviderOverride = null;

function isSentinelOnlyShareMode() {
    if (window.LIMN_SHARE_SENTINEL_ONLY === true) return true;
    const params = new URLSearchParams(window.location.search || '');
    const shareMode = params.get('share') || params.get('mode') || '';
    return shareMode === 'sentinel-only' || shareMode === 'sentinel';
}

function applySentinelOnlyShareConfig(config) {
    config.IMAGE_PROVIDER = 'sentinelhub';
    config.IMAGERY_PROVIDER = 'sentinelhub';
    config.ALLOW_SENTINEL_FALLBACK = true;
    config.SENTINEL_CREDIT_GUARD = true;
    config.SENTINEL_LIVE_TILES = true;
    return config;
}

// Modular Delegations
function getActiveConfig() {
    const merged = { ...internalAppConfig, ...(window.CONFIG || {}) };
    if (runtimeImageProviderOverride) {
        merged.IMAGE_PROVIDER = runtimeImageProviderOverride;
        merged.IMAGERY_PROVIDER = runtimeImageProviderOverride;
        if (runtimeImageProviderOverride === 'sentinelhub') {
            merged.ALLOW_SENTINEL_FALLBACK = true;
        }
    }
    if (isSentinelOnlyShareMode()) applySentinelOnlyShareConfig(merged);
    const requestedProvider = String(merged.IMAGE_PROVIDER || merged.IMAGERY_PROVIDER || 'gee').toLowerCase();
    if (requestedProvider === 'sentinelhub' && merged.ALLOW_SENTINEL_FALLBACK !== true) {
        merged.IMAGE_PROVIDER = internalAppConfig.IMAGE_PROVIDER;
        merged.IMAGERY_PROVIDER = internalAppConfig.IMAGE_PROVIDER;
    }
    return merged;
}

function getActiveProvider() {
    return getImageryProvider(getActiveConfig());
}

function getDefaultProviderLabel() {
    const cfg = { ...internalAppConfig, ...(window.CONFIG || {}) };
    if (isSentinelOnlyShareMode()) return 'SENTINEL';
    const requestedProvider = String(cfg.IMAGE_PROVIDER || cfg.IMAGERY_PROVIDER || internalAppConfig.IMAGE_PROVIDER).toLowerCase();
    if (requestedProvider === 'sentinelhub' && cfg.ALLOW_SENTINEL_FALLBACK !== true) {
        return internalAppConfig.IMAGE_PROVIDER.toUpperCase();
    }
    return requestedProvider.toUpperCase();
}

function isCogProviderActive() {
    return COG_PROVIDER_KEYS.has(getActiveProvider());
}

function isGeeProviderActive() {
    return getActiveProvider() !== 'sentinelhub';
}

function sentinelFeatureUnavailable(featureName) {
    const providerLabel = isCogProviderActive() ? 'Sentinel-2 COG tiles' : 'Earth Engine tiles';
    showToast(`${featureName} still uses Sentinel Hub/CDSE. ${providerLabel} are enabled by default, so this action is paused until a provider-neutral analytics endpoint is wired.`, 'warning');
}

function updateAnalyticsControlAvailability() {
    const hasAoi = Boolean(window.aoiDrawnItem);
    const sentinelAnalyticsReady = !isGeeProviderActive();
    const unavailableReason = sentinelAnalyticsReady
        ? 'Draw an Area of Interest first.'
        : 'Requires the guarded Sentinel analytics provider; COG/GEE currently supply map tiles only.';

    ['btn-scan-aoi', 'btn-generate-report'].forEach(id => {
        const button = document.getElementById(id);
        if (!button) return;
        const enabled = hasAoi && sentinelAnalyticsReady;
        button.disabled = !enabled;
        button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        button.title = enabled ? '' : unavailableReason;
    });
}

async function probeAcquisitions() {
    // Catalog probing only needs CDSE OAuth credentials — it is independent of which provider
    // (COG/GEE/Sentinel Hub) actually serves map tiles, so it must run under the default COG
    // provider too. isSentinelCreditGuardBlocking() is a no-op outside 'sentinelhub' mode anyway.
    if (isSentinelCreditGuardBlocking()) return;
    return probeAcquisitionsFromReport();
}

function applyIndex(isScrubbing = false) {
    enforceCogIndexSupport({ silent: isScrubbing });
    enforceCogTemporalConstraints();
    syncSentinelCreditGuardState();
    state.indexVisible = true;
    applyIndexDelegate(state, getActiveConfig(), isScrubbing);
    updateUI();
}
window.applyIndex = applyIndex;
window.downloadHTMLReport = downloadHTMLReport;

function updateUI() {
    updateUIDelegate(state, INDICES);
    setCogUiAvailability();
    updateSentinelGuardUI();
    
    // Geochemical Basin & Sensitivity Calibration UI Isolation
    const SPILL_INDEX_KEYS = ['pwi', 'pwoi', 'hpwi', 'ehc', 'lbi', 'fbc', 'reai', 'vcbi', 'aoi', 'cma', 'hmi', 'phi', 'tri', 'bpi', 'mvpi'];
    const isSpillIndex = SPILL_INDEX_KEYS.includes(state.activeIndex);
    
    const settingsContainers = document.querySelectorAll('#tab-settings .control-group');
    settingsContainers.forEach(container => {
        // Exclude opacity control from calibration isolation
        if (container.classList.contains('op-control')) return;
        
        const select = container.querySelector('select');
        const slider = container.querySelector('input[type="range"]');
        
        if (!isSpillIndex) {
            container.style.opacity = '0.4';
            container.style.pointerEvents = 'none';
            container.style.position = 'relative';
            
            // Add a clean overlay message if not already present
            let msgOverlay = container.querySelector('.calibration-overlay-msg');
            if (!msgOverlay) {
                msgOverlay = document.createElement('div');
                msgOverlay.className = 'calibration-overlay-msg';
                msgOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(10,11,20,0.45);color:var(--text-muted);font-size:9px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.05em;pointer-events:all;cursor:not-allowed;text-align:center;padding:0 12px;z-index:10;';
                msgOverlay.innerText = 'Spill Calibration Inactive';
                container.appendChild(msgOverlay);
            }
            if (select) select.disabled = true;
            if (slider) slider.disabled = true;
        } else {
            container.style.opacity = '1';
            container.style.pointerEvents = 'all';
            const msgOverlay = container.querySelector('.calibration-overlay-msg');
            if (msgOverlay) msgOverlay.remove();
            if (select) select.disabled = false;
            if (slider) slider.disabled = false;
        }
    });
}
window.updateUI = updateUI;

function updateGifInset() {
    if (isGeeProviderActive()) return;
    updateGifInsetDelegate(state, getActiveConfig());
}

function showToast(message, type = 'info') {
    showToastDelegate(message, type);
}

const tileErrorToastState = {
    message: '',
    at: 0
};

function getTileErrorMessage(event) {
    const err = event?.error;
    if (window.sentinelHubLastError?.isQuotaExhausted) {
        return 'Sentinel Hub quota exhausted: processing units or request credits are unavailable for this account.';
    }
    if (err?.isQuotaExhausted) {
        return 'Sentinel Hub quota exhausted: processing units or request credits are unavailable for this account.';
    }
    if (err?.status === 403) {
        return err.detail ? `Sentinel Hub denied tile access: ${err.detail}` : 'Sentinel Hub denied tile access with HTTP 403.';
    }
    if (err?.status === 429) {
        return err.detail
            ? `Sentinel Hub rate limited the tile request: ${err.detail}`
            : 'Sentinel Hub rate limited tile requests. Limn is cooling down before retrying.';
    }
    if (err?.status) {
        return err.detail
            ? `Sentinel Hub tile error HTTP ${err.status}: ${err.detail}`
            : `Sentinel Hub tile error HTTP ${err.status}.`;
    }
    return `Sentinel Hub tile request failed for ${event?.layer || 'selected'}; checking account quota and network status.`;
}

function showDedupedTileToast(message) {
    const now = Date.now();
    if (tileErrorToastState.message === message && now - tileErrorToastState.at < 15000) return;
    tileErrorToastState.message = message;
    tileErrorToastState.at = now;
    showToast(message, 'error');
}

function showTileErrorToast(event) {
    showDedupedTileToast(getTileErrorMessage(event));
}

window.addEventListener('sentinelhuberror', (event) => {
    const detail = event.detail || {};
    if (detail.isQuotaExhausted) {
        showDedupedTileToast('Sentinel Hub quota exhausted: processing units or request credits are unavailable for this account.');
        return;
    }
    if (detail.status) {
        showDedupedTileToast(detail.message || `Sentinel Hub request failed with HTTP ${detail.status}.`);
    }
});

// Globals for Report Generation (Exposed for report.js and charts.js)
window.aoiDrawnItem = null;
window.reportChartInst = null;
window.primaryChartInst = null;
window.secondaryChartInst = null;
window.reportMapInst = null;
window.reportDiffMapInst = null;

// NOTE: CALIBRATION_PRESETS, evalscript generators, palettes, INDICES,
// HIGHLIGHT_THRESHOLDS, CHART_COLORS, getHighlightScript → see indices.js

const BASE_LAYERS = {
    imagery: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    topo: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    osm: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
};

const state = {
    map: null,
    baseLayerInst: null,
    activeLoc: 'dixon',
    activeIndex: DEFAULT_INDEX,
    activeSpillId: DEFAULT_SPILL_ID,
    activeEvidenceStage: 'event',
    activeEvidenceComparison: '',
    activeBasin: 'permian',
    mode: 'single', // 'single' or 'compare'
    compareType: 'swipe', // 'swipe' | 'diff' | 'cumulative'
    monthIndex: Math.max(0, ALL_DATES.length - 1),
    sarFusion: false, // track the state of the SAR Overlay toggle
    hlsEnabled: false, // NASA HLS temporal booster
    opacity: 0.85,
    indexVisible: true,
    visualFilter: 0,
    sensitivity: 0, // Dynamic threshold offset (-50 to 50)
    sentinelLiveTiles: false,
    sentinelMinZoom: 14,
    sentinelGuardInitialized: false,
    sentinelRateLimitedUntil: 0,
    overlayGroup: null,
    leftGroup: null,
    rightGroup: null,
    sbsControl: null,
    primaryChart: null,
    secondaryChart: null,

    anomalousDates: [], // Array of 'YYYY-MM-DD' strings flagged by the scanner
    validSentinelDates: null, // Set of 'YYYY-MM-DD' strings with a real S1/S2 scene; null until first catalog probe resolves
    rrcSpillLayer: null, // Leaflet layer group for RRC spill markers
    rrcSpillData: null,   // Cached GeoJSON after first fetch
    hoverHighlightLayer: null, // Temporary overlay for chart-hover highlighting
    hoverMarker: null,
    searchMarker: null // Marker dropped at manually entered/searched coordinates
};

// Expose core objects to global window scope for modular accessibility
window.state = state;
window.CONFIG = getActiveConfig();
window.ALL_DATES = ALL_DATES;
window.MONTHS = MONTHS;
window.getLimnProviderState = () => ({
    provider: getActiveProvider(),
    defaultProvider: getDefaultProviderLabel().toLowerCase(),
    runtimeImageProviderOverride,
    sentinelOnlyShareMode: isSentinelOnlyShareMode(),
    sentinelLiveTiles: state.sentinelLiveTiles === true,
    sentinelMinZoom: state.sentinelMinZoom,
    sentinelRateLimitedUntil: state.sentinelRateLimitedUntil || 0,
    zoom: state.map?.getZoom?.() ?? null,
    guardBlocking: isSentinelCreditGuardBlocking(),
    status: document.getElementById('sentinel-guard-status')?.textContent || ''
});

function getSpillById(spillId) {
    return SPILL_BOOKMARKS.find(spill => spill.id === spillId) || SPILL_BOOKMARKS[0];
}

function getDemoSpillBookmarks(indexKey = null) {
    return SPILL_BOOKMARKS.filter(spill => {
        const indices = spill.indices || [];
        const providerReadyIndices = isCogProviderActive()
            ? indices.filter(idx => COG_SUPPORTED_INDEX_KEYS.has(idx))
            : indices;
        if (indexKey) return providerReadyIndices.includes(indexKey);
        return providerReadyIndices.length > 0;
    });
}

function getActiveSpill() {
    return getSpillById(state.activeSpillId);
}

function setClosestDateValue(targetStr) {
    const closestIdx = closestDateIndex(targetStr, state.validSentinelDates);
    if (closestIdx == null) return null;

    state.monthIndex = closestIdx;
    const dateSingleEl = document.getElementById('date-single');
    if (dateSingleEl) dateSingleEl.value = closestIdx.toString();
    return ALL_DATES[closestIdx]?.value || null;
}

function setClosestDateForSpill(spill) {
    return setClosestDateValue(spill?.date || spill?.displayDate);
}

function getActiveEvidenceTimeline(spill = getActiveSpill()) {
    return buildSpillEvidenceTimeline(
        spill,
        ALL_DATES[0]?.value,
        ALL_DATES[ALL_DATES.length - 1]?.value,
    );
}

function formatTimelineDate(dateStr) {
    const date = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' });
}

function updateEvidenceConfounderControl() {
    const button = document.getElementById('timeline-road-check');
    if (!button) return;
    const osmActive = document.querySelector('.layer-toggle.active')?.dataset.layer === 'osm';
    button.classList.toggle('active', osmActive);
    button.setAttribute('aria-pressed', osmActive ? 'true' : 'false');
    button.textContent = osmActive ? 'Return to imagery' : 'OSM road check';
}

function renderSpillEvidenceTimeline(spill = getActiveSpill()) {
    const timelineEl = document.getElementById('spill-evidence-timeline');
    if (!timelineEl || !spill) return;
    const timeline = getActiveEvidenceTimeline(spill);
    timelineEl.dataset.spillId = spill.id || '';

    timelineEl.querySelectorAll('[data-evidence-stage]').forEach(button => {
        const stage = timeline.stages.find(candidate => candidate.id === button.dataset.evidenceStage);
        if (!stage) return;
        const dateEl = button.querySelector('.evidence-stage__date');
        if (dateEl) dateEl.textContent = formatTimelineDate(stage.date);
        button.title = `${stage.role}. Target ${stage.targetDate}${stage.clamped ? `; limited to ${stage.date} by viewer availability` : ''}.`;
        const active = state.mode === 'single' && state.activeEvidenceStage === stage.id;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const anchorEl = document.getElementById('timeline-anchor-status');
    if (anchorEl) anchorEl.textContent = `${timeline.anchorSource} · ${timeline.anchorDate}`;
    const disclosureEl = document.getElementById('timeline-disclosure');
    if (disclosureEl) {
        disclosureEl.textContent = 'Dates are scene-search targets: COG selects a nearby low-cloud Sentinel-2 acquisition. Repeated response supports persistence review, not source attribution.';
    }
    document.querySelectorAll('.evidence-lens-btn').forEach(button => {
        const active = button.dataset.index === state.activeIndex;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    updateEvidenceConfounderControl();
}

function setTemporalMode(mode, { apply = true } = {}) {
    const isCompare = mode === 'compare';
    state.mode = isCompare ? 'compare' : 'single';
    if (isCompare) enforceCogTemporalConstraints();
    document.getElementById('mode-single')?.classList.toggle('active', !isCompare);
    document.getElementById('mode-compare')?.classList.toggle('active', isCompare);
    const singleContainer = document.getElementById('single-time-container');
    const compareContainer = document.getElementById('compare-dates-container');
    if (singleContainer) singleContainer.style.display = isCompare ? 'none' : 'block';
    if (compareContainer) compareContainer.style.display = isCompare ? 'block' : 'none';
    updateWorkflowTemporalStatus();
    renderSpillEvidenceTimeline();
    if (apply) applyIndex();
}

function showEvidenceStage(stageId) {
    const timeline = getActiveEvidenceTimeline();
    const stage = timeline.stages.find(candidate => candidate.id === stageId);
    if (!stage) return;
    setClosestDateValue(stage.date);
    state.activeEvidenceStage = stage.id;
    state.activeEvidenceComparison = '';
    setTemporalMode('single');
}

function compareEvidenceStages(leftStageId, rightStageId) {
    const timeline = getActiveEvidenceTimeline();
    const left = timeline.stages.find(stage => stage.id === leftStageId);
    const right = timeline.stages.find(stage => stage.id === rightStageId);
    if (!left || !right) return;
    const t1 = document.getElementById('date-t1');
    const t2 = document.getElementById('date-t2');
    if (!t1 || !t2) return;
    t1.value = left.date;
    t2.value = right.date;
    state.compareType = 'swipe';
    state.activeEvidenceStage = '';
    state.activeEvidenceComparison = `${left.label} ↔ ${right.label}`;
    document.getElementById('btn-swipe')?.classList.add('active');
    document.getElementById('btn-diff')?.classList.remove('active');
    document.getElementById('btn-cumulative')?.classList.remove('active');
    setTemporalMode('compare');
}

function updateWorkflowSummary(spill = getActiveSpill(), indexKey = state.activeIndex) {
    const indexConfig = INDICES[indexKey];
    const lensEl = document.getElementById('workflow-lens');
    const siteEl = document.getElementById('workflow-site');
    const evidenceEl = document.getElementById('workflow-evidence');

    if (lensEl) {
        const shortLabel = indexKey === 'tc' ? 'True Color' : (INDEX_SHORT_LABELS[indexKey] || indexKey.toUpperCase());
        const longName = indexConfig?.name?.replace(/\s*\(formerly.*?\)/i, '') || shortLabel;
        lensEl.textContent = shortLabel;
        lensEl.title = longName;
    }
    if (siteEl && spill) siteEl.textContent = spill.label;
    if (evidenceEl && spill) {
        const evidenceClass = (spill.evidenceClass || 'screening target').replace(/-/g, ' ');
        const displayDate = spill.displayDate || spill.date;
        evidenceEl.textContent = `${displayDate} · ${evidenceClass}`;
    }
    updateWorkflowTemporalStatus();
}

function updateWorkflowTemporalStatus() {
    const temporalStatus = document.getElementById('workflow-temporal-status');
    if (!temporalStatus) return;
    temporalStatus.textContent = state.mode === 'compare'
        ? (state.activeEvidenceComparison || (state.compareType === 'swipe' ? 'Before / after active' : 'Change view active'))
        : (state.activeEvidenceStage ? `${state.activeEvidenceStage} scene` : 'Single scene');
    temporalStatus.classList.toggle('quality-chip--conditional', state.mode !== 'compare');
}

function updatePixelQualityStatus() {
    const config = getActiveConfig();
    const provider = getActiveProvider();
    const sclAvailable = provider !== 'sentinelhub' || config.SENTINEL_WMS_SUPPORTS_SCL === true;
    document.querySelectorAll('[data-quality="scl"]').forEach(chip => {
        chip.textContent = sclAvailable ? 'SCL pixel QA on' : 'WMS: no SCL band';
        chip.classList.toggle('quality-chip--conditional', !sclAvailable);
        chip.title = sclAvailable
            ? 'Sentinel-2 Scene Classification masks cloud, shadow, snow, saturated, dark-feature, and no-data pixels.'
            : 'The active Sentinel Hub WMS layer is Sentinel-2 L1C, which has no SCL band. Limn omits the SCL gate for this provider; use COG/GEE or an L2A WMS configuration for pixel-level SCL QA.';
    });
}

function markActiveWorkflowControls() {
    document.querySelectorAll('.triage-tag-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.index === state.activeIndex);
    });
    document.querySelectorAll('.triage-bm-btn, .spill-bookmark-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.spillId === state.activeSpillId);
    });
    document.querySelectorAll('.triage-bm-row').forEach(row => {
        row.classList.toggle('active', row.dataset.spillId === state.activeSpillId);
    });
    document.querySelectorAll('.triage-bm-chip').forEach(chip => {
        const isActiveSite = chip.dataset.spillId === state.activeSpillId;
        const isActiveIndex = chip.dataset.index === state.activeIndex;
        const isActive = state.indexVisible && isActiveSite && isActiveIndex;
        chip.classList.toggle('active', isActive);
        chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    renderSpillEvidenceTimeline();
}

function selectSpill(spill, { fly = false } = {}) {
    if (!spill) return;
    state.activeSpillId = spill.id || DEFAULT_SPILL_ID;
    setClosestDateForSpill(spill);
    state.activeEvidenceStage = 'event';
    state.activeEvidenceComparison = '';

    document.getElementById('disp-lat').innerText = spill.lat.toFixed(4) + '°';
    document.getElementById('disp-lng').innerText = spill.lng.toFixed(4) + '°';
    if (fly && state.map) {
        state.map.flyTo([spill.lat, spill.lng], spill.zoom, { duration: 1.5 });
    }

    updateWorkflowSummary(spill, state.activeIndex);
    renderSpillEvidenceTimeline(spill);
    markActiveWorkflowControls();
}

function hideIndexOverlay() {
    if (!state.map) return;
    if (state.sbsControl) {
        try { state.sbsControl.remove(); } catch (_) {}
        state.sbsControl = null;
    }
    ['overlayGroup', 'leftGroup', 'rightGroup'].forEach(key => {
        if (state[key]) {
            state.map.removeLayer(state[key]);
            state[key] = null;
        }
    });
    state.indexVisible = false;
    markActiveWorkflowControls();
}

function getProviderReadyBookmarkIndices(spill) {
    const indices = spill?.indices || [];
    return isCogProviderActive()
        ? indices.filter(idx => COG_SUPPORTED_INDEX_KEYS.has(idx))
        : indices;
}

function isIndexProviderReady(indexKey) {
    return !isCogProviderActive() || COG_SUPPORTED_INDEX_KEYS.has(indexKey);
}

let lastCogUnsupportedToast = '';

function enforceCogIndexSupport({ silent = false } = {}) {
    if (!isCogProviderActive() || COG_SUPPORTED_INDEX_KEYS.has(state.activeIndex)) return true;
    const previousIndex = state.activeIndex;
    state.activeIndex = DEFAULT_INDEX;
    state.indexVisible = true;
    if (!silent && previousIndex !== lastCogUnsupportedToast) {
        const label = INDEX_SHORT_LABELS[previousIndex] || previousIndex.toUpperCase();
        showToast(`${label} is not ported to the COG renderer yet. Switched to True Color for the current provider.`, 'warning');
        lastCogUnsupportedToast = previousIndex;
    }
    return false;
}

function enforceCogTemporalConstraints() {
    if (!isCogProviderActive()) return;
    if (state.compareType === 'diff' || state.compareType === 'cumulative') {
        state.compareType = 'swipe';
    }
}

function setCogUiAvailability() {
    const isCog = isCogProviderActive();
    document.body.classList.toggle('provider-cog', isCog);

    document.querySelectorAll('.index-btn[data-index]').forEach(btn => {
        const key = btn.dataset.index;
        const supported = !isCog || COG_SUPPORTED_INDEX_KEYS.has(key);
        btn.disabled = !supported;
        btn.classList.toggle('is-provider-disabled', !supported);
        btn.setAttribute('aria-disabled', supported ? 'false' : 'true');
        if (!supported) {
            btn.title = 'Not available in the current COG renderer.';
        } else if (btn.title === 'Not available in the current COG renderer.') {
            btn.removeAttribute('title');
        }
    });

    document.querySelectorAll('.triage-tag-pill[data-index]').forEach(pill => {
        const key = pill.dataset.index;
        const visible = !isCog || COG_SCREEN_INDEX_KEYS.has(key);
        pill.hidden = !visible;
        pill.disabled = !visible;
        pill.classList.toggle('is-provider-disabled', !visible);
    });

    document.querySelectorAll('.evidence-lens-btn[data-index]').forEach(button => {
        const supported = !isCog || COG_SUPPORTED_INDEX_KEYS.has(button.dataset.index);
        button.disabled = !supported;
        button.classList.toggle('is-provider-disabled', !supported);
        button.setAttribute('aria-disabled', supported ? 'false' : 'true');
    });

    document.querySelectorAll('.sar-action').forEach(button => {
        button.disabled = isCog;
        button.setAttribute('aria-disabled', isCog ? 'true' : 'false');
        button.title = isCog
            ? 'Sentinel-1 context requires the guarded Sentinel provider. Arm "Sentinel" in the header to enable.'
            : 'Compares VV backscatter between two dates — a new dark/smooth patch can indicate a new liquid surface. Screening signal only, not a chemical measurement.';
    });

    const btnSwipe = document.getElementById('btn-swipe');
    const btnDiff = document.getElementById('btn-diff');
    const btnCumulative = document.getElementById('btn-cumulative');
    if (btnSwipe && btnDiff && btnCumulative) {
        btnSwipe.classList.toggle('active', state.compareType === 'swipe');
        btnDiff.classList.toggle('active', state.compareType === 'diff');
        btnCumulative.classList.toggle('active', state.compareType === 'cumulative');
        [btnDiff, btnCumulative].forEach(btn => {
            btn.disabled = isCog;
            btn.classList.toggle('is-provider-disabled', isCog);
            btn.setAttribute('aria-disabled', isCog ? 'true' : 'false');
            btn.title = isCog ? 'COG mode supports single-date and swipe compare only.' : '';
        });
    }
    updateAnalyticsControlAvailability();
    updateWorkflowTemporalStatus();
    updatePixelQualityStatus();
}

function syncSentinelCreditGuardState() {
    if (state.sentinelGuardInitialized) return;
    const config = getActiveConfig();
    state.sentinelLiveTiles = config.SENTINEL_LIVE_TILES === true;
    runtimeImageProviderOverride = config.SENTINEL_LIVE_TILES === true && getImageryProvider(config) === 'sentinelhub'
        ? 'sentinelhub'
        : null;
    if (isSentinelOnlyShareMode()) {
        runtimeImageProviderOverride = 'sentinelhub';
        state.sentinelLiveTiles = true;
    }
    const configuredMinZoom = Number(config.SENTINEL_MIN_ZOOM || state.sentinelMinZoom || 14);
    state.sentinelMinZoom = Number.isFinite(configuredMinZoom) ? configuredMinZoom : 14;
    state.sentinelGuardInitialized = true;
}

function updateSentinelGuardUI() {
    const provider = getActiveProvider();
    const isSentinel = provider === 'sentinelhub';
    const guardEnabled = getActiveConfig().SENTINEL_CREDIT_GUARD !== false;
    const minZoom = state.sentinelMinZoom || 14;
    const currentZoom = state.map?.getZoom?.() ?? 0;
    const sentinelActive = isSentinel && state.sentinelLiveTiles === true;
    const toggle = document.getElementById('toggle-sentinel-live');
    const zoomSlider = document.getElementById('sentinel-min-zoom');
    const zoomVal = document.getElementById('sentinel-min-zoom-val');
    const status = document.getElementById('sentinel-guard-status');
    const guardMini = document.querySelector('.sentinel-guard-mini');
    const shareMode = isSentinelOnlyShareMode();
    updatePixelQualityStatus();

    if (toggle) {
        toggle.checked = shareMode ? true : sentinelActive;
        toggle.disabled = shareMode || !guardEnabled;
        toggle.title = shareMode
            ? 'Sentinel-only share mode is locked to guarded WMS tiles'
            : sentinelActive
            ? 'Switch back to the default COG/GEE renderer'
            : 'Switch this session to guarded Sentinel Hub WMS tiles';
    }
    if (guardMini) {
        guardMini.classList.toggle('is-armed', shareMode || sentinelActive);
        guardMini.classList.toggle('is-share-mode', shareMode);
    }
    if (zoomSlider) {
        zoomSlider.value = String(minZoom);
        zoomSlider.disabled = !guardEnabled;
    }
    if (zoomVal) zoomVal.textContent = `${minZoom}+`;

    if (!status) return;
    if (shareMode && state.sentinelRateLimitedUntil > Date.now()) {
        const seconds = Math.max(1, Math.ceil((state.sentinelRateLimitedUntil - Date.now()) / 1000));
        status.textContent = `Share mode: cooling down ${seconds}s.`;
    } else if (shareMode && currentZoom < minZoom) {
        status.textContent = `Share mode: Sentinel-only, guarded until zoom ${minZoom}+ (current ${currentZoom}).`;
    } else if (shareMode) {
        status.textContent = `Share mode: Sentinel-only WMS armed at zoom ${currentZoom}.`;
    } else if (!guardEnabled) {
        status.textContent = 'Guard disabled by config. Sentinel Hub requests are allowed.';
    } else if (!isSentinel) {
        status.textContent = `${getDefaultProviderLabel()} active. Toggle Sentinel to request guarded WMS tiles.`;
    } else if (!state.sentinelLiveTiles) {
        status.textContent = 'Disarmed. Sentinel Hub WMS tiles are blocked.';
    } else if (state.sentinelRateLimitedUntil > Date.now()) {
        const seconds = Math.max(1, Math.ceil((state.sentinelRateLimitedUntil - Date.now()) / 1000));
        status.textContent = `Rate limited. Cooling down ${seconds}s before more Sentinel WMS tiles.`;
    } else if (currentZoom < minZoom) {
        status.textContent = `Armed, but blocked until zoom ${minZoom}+ (current ${currentZoom}).`;
    } else {
        status.textContent = `Armed. Sentinel Hub WMS may request tiles at zoom ${currentZoom}.`;
    }
}

function isSentinelCreditGuardBlocking() {
    if (getActiveProvider() !== 'sentinelhub') return false;
    const config = getActiveConfig();
    if (config.SENTINEL_CREDIT_GUARD === false) return false;
    const currentZoom = state.map?.getZoom?.() ?? 0;
    return !state.sentinelLiveTiles || currentZoom < state.sentinelMinZoom;
}


export function renderSpillBookmarks(indexKey = state.activeIndex) {
    const spillList = document.getElementById('spill-bookmark-list');
    if (!spillList) return;
    spillList.innerHTML = '';

    const bookmarks = getDemoSpillBookmarks(indexKey);

    // Update section title & disclaimer
    const sectionTitle = document.querySelector('.spill-bookmarks-section h3');
    const sectionDisclaimer = document.querySelector('.spill-disclaimer');
    if (sectionTitle) sectionTitle.textContent = 'Screening Sites';
    if (sectionDisclaimer) sectionDisclaimer.textContent = 'Only sites with a current measured chip for this lens are listed.';

    bookmarks.forEach(spill => {
        const btn = document.createElement('button');
        btn.className = 'spill-bookmark-btn';
        btn.dataset.spillId = spill.id || spill.label.replace(/\s+/g, '-').toLowerCase();
        btn.classList.toggle('active', btn.dataset.spillId === state.activeSpillId);

        const tooltipText = `<strong>${spill.label}</strong><br>${spill.note}<br><br>📅 ${spill.displayDate} &nbsp;|&nbsp; 📦 ${spill.volume}<br>📡 ${spill.source}<br>⚠ Coords: ${spill.confidence}`;
        btn.setAttribute('data-tooltip', tooltipText);

        btn.innerHTML = `<span class="spill-name">${spill.label}</span><span class="spill-date-tag">${spill.displayDate}</span>`;
        
        btn.addEventListener('click', () => {
            selectSpill(spill, { fly: true });

            // Deselect preset location buttons and spill buttons
            document.querySelectorAll('.loc-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.spill-bookmark-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            markActiveWorkflowControls();

            // Force single date mode on bookmark click for instant cloud-free imagery
            if (state.mode !== 'single') {
                setTemporalMode('single');
            } else {
                applyIndex();
            }
            setTimeout(() => probeAcquisitions(), 1600);
        });
        spillList.appendChild(btn);
    });
}
window.renderSpillBookmarks = renderSpillBookmarks;

// Populates a select element with grouped dates. When `validSet` (a Set of 'YYYY-MM-DD' strings)
// is provided, only dates present in it are rendered (tagged ' [S]') — used once the CDSE catalog
// probe has resolved. Left null/undefined, every synthetic ALL_DATES entry renders unfiltered,
// which is the fail-open state before the first probe resolves.
function populateGroupedDates(selectEl, dates, isValueIndex = false, validSet = null) {
    if (!selectEl) return;
    selectEl.innerHTML = '';

    let currentYear = null;
    let currentMonth = null;
    let currentMonthGroup = null;

    const filtered = validSet ? dates.filter(d => validSet.has(d.value)) : dates;
    // Newest dates at the top
    const sorted = [...filtered].reverse();

    for (const dateObj of sorted) {
        const dateValue = dateObj.value; // e.g. "2026-03-17"
        const dateText = (dateObj.displayStr || dateObj.label || dateValue) + (validSet ? ' [S]' : '');

        const parts = dateValue.split('-');
        const yr = parts[0];
        const monIdx = parseInt(parts[1], 10) - 1;
        const mon = MONTHS[monIdx] || '???';

        if (mon !== currentMonth || yr !== currentYear) {
            currentYear = yr;
            currentMonth = mon;
            currentMonthGroup = document.createElement('optgroup');
            currentMonthGroup.label = `${mon} ${yr}`;
            selectEl.appendChild(currentMonthGroup);
        }

        const opt = document.createElement('option');
        if (isValueIndex) {
            // Value must be an index into the GLOBAL ALL_DATES array, not the (possibly filtered)
            // `dates` being iterated here — downstream code reads window.ALL_DATES[selectEl.value].
            opt.value = ALL_DATES.indexOf(dateObj).toString();
        } else {
            opt.value = dateValue;
        }
        opt.textContent = dateText;
        if (validSet) opt.className = 'opt-s2';
        currentMonthGroup.appendChild(opt);
    }
}

// Finds the index (into ALL_DATES) of the valid Sentinel date closest to targetStr. Falls back to
// the closest date in the full ALL_DATES array when no validSet is available yet (fail open).
function closestDateIndex(targetStr, validSet) {
    const target = new Date(targetStr).getTime();
    if (Number.isNaN(target)) return null;

    const restrict = validSet && validSet.size > 0;
    let closestIdx = null;
    let minDiff = Infinity;
    ALL_DATES.forEach((dateOption, index) => {
        if (restrict && !validSet.has(dateOption.value)) return;
        const diff = Math.abs(new Date(dateOption.value).getTime() - target);
        if (diff < minDiff) {
            minDiff = diff;
            closestIdx = index;
        }
    });
    return closestIdx;
}

// Re-renders date-single/date-t1/date-t2 against a freshly-probed valid-date set, preserving the
// current selection where it survives filtering and snapping to the nearest valid date otherwise.
function rebuildDateSelectors(validSet) {
    const selSingle = document.getElementById('date-single');
    const t1Sel = document.getElementById('date-t1');
    const t2Sel = document.getElementById('date-t2');

    const prevSingleDate = selSingle ? (ALL_DATES[parseInt(selSingle.value, 10)]?.value || null) : null;
    const prevT1 = t1Sel ? t1Sel.value : null;
    const prevT2 = t2Sel ? t2Sel.value : null;

    if (selSingle) populateGroupedDates(selSingle, ALL_DATES, true, validSet);
    if (t1Sel) populateGroupedDates(t1Sel, ALL_DATES, false, validSet);
    if (t2Sel) populateGroupedDates(t2Sel, ALL_DATES, false, validSet);

    if (selSingle) {
        const idx = closestDateIndex(prevSingleDate || ALL_DATES[ALL_DATES.length - 1].value, validSet);
        if (idx != null) {
            selSingle.value = idx.toString();
            state.monthIndex = idx;
        }
    }
    if (t1Sel && prevT1 && !t1Sel.querySelector(`option[value="${prevT1}"]`)) {
        t1Sel.selectedIndex = 0;
    } else if (t1Sel && prevT1) {
        t1Sel.value = prevT1;
    }
    if (t2Sel && prevT2 && !t2Sel.querySelector(`option[value="${prevT2}"]`)) {
        t2Sel.selectedIndex = Math.min(10, t2Sel.options.length - 1);
    } else if (t2Sel && prevT2) {
        t2Sel.value = prevT2;
    }
}
window.rebuildDateSelectors = rebuildDateSelectors;

// ── INIT ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (isSentinelOnlyShareMode()) {
        document.body.classList.add('sentinel-only-share-mode');
    }

    const vBadge = document.getElementById('app-version-badge');
    if (vBadge) vBadge.textContent = APP_VERSION;

    const selSingle = document.getElementById('date-single');
    const t1Sel = document.getElementById('date-t1');
    const t2Sel = document.getElementById('date-t2');

    // Populate all selectors found in the DOM (unfiltered until the first catalog probe resolves)
    if (selSingle) populateGroupedDates(selSingle, ALL_DATES, true);
    if (t1Sel) populateGroupedDates(t1Sel, ALL_DATES, false);
    if (t2Sel) populateGroupedDates(t2Sel, ALL_DATES, false);

    // Initial Defaults
    state.monthIndex = ALL_DATES.length - 1; // Newest entry in chronological array
    if (selSingle) selSingle.value = state.monthIndex.toString();

    // In newest-first mode, index 0 is most recent
    if (t1Sel) t1Sel.selectedIndex = 0;
    if (t2Sel) t2Sel.selectedIndex = Math.min(10, t2Sel.options.length - 1); // Select a date ~10 steps prior


    const initialSpill = getActiveSpill();
    const initialMapLocation = initialSpill
        ? { lat: initialSpill.lat, lng: initialSpill.lng, zoom: initialSpill.zoom }
        : AOI_LOCATIONS[state.activeLoc];
    state.map = initLeafletMap('map', initialMapLocation);
    
    // Bind Map Events for Loading & Errors
    const mapLoader = document.getElementById('map-loader');
    const mapLayerStatus = document.getElementById('map-layer-status');
    const setMapLayerStatus = (mode, layerKey = state.activeIndex) => {
        if (!mapLayerStatus) return;
        const label = layerKey === 'tc'
            ? 'True Color'
            : (INDEX_SHORT_LABELS[layerKey] || String(layerKey || 'Layer').toUpperCase());
        mapLayerStatus.classList.remove('is-loading', 'is-ready', 'is-error');
        mapLayerStatus.classList.add(`is-${mode}`);
        if (mode === 'loading') mapLayerStatus.textContent = `Loading ${label}…`;
        if (mode === 'ready') {
            mapLayerStatus.textContent = SCREENING_VISIBILITY_INDEX_KEYS.has(layerKey)
                ? `${label} loaded · muted = screened/no flag · bright = candidate`
                : `${label} loaded · sparse or blank response can be valid`;
        }
        if (mode === 'error') mapLayerStatus.textContent = `${label} failed to load · see the error message`;
    };
    state.map.on('tileloadstart', (event) => {
        if (event?.layer && event.layer !== state.activeIndex) return;
        if (mapLoader) mapLoader.classList.add('active');
        setMapLayerStatus('loading', event?.layer);
    });
    state.map.on('tileloadfinish', (event) => {
        if (event?.layer && event.layer !== state.activeIndex) return;
        if (mapLoader) mapLoader.classList.remove('active');
        setMapLayerStatus('ready', event?.layer);
    });
    state.map.on('tileerror', (e) => {
        if (e?.layer && e.layer !== state.activeIndex) return;
        if (mapLoader) mapLoader.classList.remove('active');
        setMapLayerStatus('error', e?.layer);
        showTileErrorToast(e);
    });
    state.map.on('sentinelguard', (e) => {
        updateSentinelGuardUI();
        const detail = e?.status || {};
        const usingCog = e?.fallback === 'cog';
        const cogNote = usingCog ? ' Showing the free COG renderer for this lens instead.' : '';
        if (detail.reason === 'disarmed') {
            showToast(`Sentinel Hub live tiles are disarmed. Enable them in Settings to spend credits.${cogNote}`, 'info');
        } else if (detail.reason === 'zoom') {
            showToast(`Sentinel Hub guarded below zoom ${detail.minZoom}. Zoom in to render WMS tiles.${cogNote}`, 'info');
        }
    });
    state.map.on('sentinelratelimit', (e) => {
        const retryAfterMs = Number(e?.retryAfterMs || 15000);
        state.sentinelRateLimitedUntil = Math.max(state.sentinelRateLimitedUntil || 0, Date.now() + retryAfterMs);
        updateSentinelGuardUI();
        showDedupedTileToast(`Sentinel Hub rate limit reached. Cooling down ${Math.ceil(retryAfterMs / 1000)}s before retrying WMS tiles.`);
    });
    state.map.on('zoomend', () => {
        updateSentinelGuardUI();
        if (getActiveProvider() === 'sentinelhub' && state.indexVisible) applyIndex();
    });

    // Initialize Base Layer
    state.baseLayerInst = L.tileLayer(BASE_LAYERS.imagery, { maxZoom: 18 }).addTo(state.map);
    state.baseLayerInst.bringToBack();

    bindEvents();
    syncSentinelCreditGuardState();
    updateSentinelGuardUI();

    // Initial Data Load
    selectSpill(getActiveSpill());
    renderSpillBookmarks(state.activeIndex);
    applyIndex();
    probeAcquisitions();

    // Remove loading overlay
    setTimeout(() => {
        document.getElementById('loading').style.opacity = '0';
        setTimeout(() => document.getElementById('loading').style.display = 'none', 500);
    }, 1200);
});

// initMap logic moved to map.js

/**
 * GENERATES A NEON HIGHLIGHT EVALSCRIPT
 * Uses indices' fisLogic to isolate high-value pixels in neon pink/green.
 */

// NOTE: getHighlightScript, chart hover highlight, peak detection → see indices.js / charts.js

// ── EVENT BINDINGS ─────────────────────────────────
function bindEvents() {

    // Sidebar Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.currentTarget.dataset.tab);
        });
    });

    // Mode Switcher
    const mSing = document.getElementById('mode-single');
    const mComp = document.getElementById('mode-compare');

    mSing.addEventListener('click', () => {
        state.activeEvidenceStage = '';
        state.activeEvidenceComparison = '';
        setTemporalMode('single');
    });

    mComp.addEventListener('click', () => {
        state.activeEvidenceStage = '';
        state.activeEvidenceComparison = '';
        setTemporalMode('compare');
    });

    // Compare Layout Toggle
    const btnSwipe = document.getElementById('btn-swipe');
    const btnDiff = document.getElementById('btn-diff');
    const btnCumulative = document.getElementById('btn-cumulative'); // Added this line
    if (btnSwipe && btnDiff && btnCumulative) { // Modified condition
        document.getElementById('btn-swipe').addEventListener('click', () => {
            state.compareType = 'swipe';
            state.activeEvidenceComparison = '';
            document.getElementById('btn-swipe').classList.add('active');
            document.getElementById('btn-diff').classList.remove('active');
            document.getElementById('btn-cumulative').classList.remove('active');
            updateWorkflowTemporalStatus();
            applyIndex();
        });
        document.getElementById('btn-diff').addEventListener('click', () => {
            if (isCogProviderActive()) return;
            state.compareType = 'diff';
            state.activeEvidenceComparison = '';
            document.getElementById('btn-diff').classList.add('active');
            document.getElementById('btn-swipe').classList.remove('active');
            document.getElementById('btn-cumulative').classList.remove('active');
            updateWorkflowTemporalStatus();
            applyIndex();
        });
        document.getElementById('btn-cumulative').addEventListener('click', () => {
            if (isCogProviderActive()) return;
            state.compareType = 'cumulative';
            state.activeEvidenceComparison = '';
            document.getElementById('btn-cumulative').classList.add('active');
            document.getElementById('btn-swipe').classList.remove('active');
            document.getElementById('btn-diff').classList.remove('active');
            updateWorkflowTemporalStatus();
            applyIndex();
        });
    }

    // Index Buttons & Info Icons
    document.querySelectorAll('.index-btn').forEach(btn => {
        const shortSpan = btn.querySelector('.index-short');
        const fullSpan = btn.querySelector('.index-full');
        
        if (shortSpan) {
            // Ensure Name container exists
            let nameWrapper = btn.querySelector('.index-name-wrapper');
            if (!nameWrapper) {
                nameWrapper = document.createElement('div');
                nameWrapper.className = 'index-name-wrapper';
                shortSpan.parentNode.insertBefore(nameWrapper, shortSpan);
                nameWrapper.appendChild(shortSpan);
                if (fullSpan) {
                    nameWrapper.appendChild(fullSpan);
                    fullSpan.style.display = 'block'; // Ensure full name is visible
                }
            }

            // Create top container for Name + Badge/Info
            let topContainer = btn.querySelector('.index-btn-top');
            if (!topContainer) {
                topContainer = document.createElement('div');
                topContainer.className = 'index-btn-top';
                nameWrapper.parentNode.insertBefore(topContainer, nameWrapper);
                topContainer.appendChild(nameWrapper);
            }

            const idxKey = btn.dataset.index;
            const cfg = INDICES[idxKey];
            if (cfg) {
                // Info Icon for Tooltip (requested by user)
                if (cfg.info) {
                    let infoIcon = btn.querySelector('.index-info-icon');
                    if (!infoIcon) {
                        infoIcon = document.createElement('span');
                        infoIcon.className = 'index-info-icon';
                        infoIcon.innerHTML = '&#9432;'; // ⓘ icon
                        topContainer.appendChild(infoIcon);
                    }
                    // Keep or set tooltip on both the button itself and the info icon for maximum hover accessibility
                    const tooltipText = btn.getAttribute('data-tooltip') || `<strong>${cfg.name}</strong><br>${cfg.info}`;
                    btn.setAttribute('data-tooltip', tooltipText);
                    infoIcon.setAttribute('data-tooltip', tooltipText);
                    
                    // Prevent button click when clicking info icon
                    infoIcon.onclick = (e) => e.stopPropagation();
                }
                
                // Capability Badges (Salinity / Produced-Water Brine Screen) — rendered before the
                // temporal badge so the temporal badge stays the last/rightmost item.
                if (Array.isArray(cfg.tags) && cfg.tags.length && !btn.querySelector('.capability-badge')) {
                    let tagCont = btn.querySelector('.tag-container');
                    if (!tagCont) {
                        tagCont = document.createElement('div');
                        tagCont.className = 'tag-container';
                        btn.insertBefore(tagCont, btn.firstChild);
                    }
                    cfg.tags.forEach(tag => {
                        const def = CAPABILITY_BADGES[tag];
                        if (!def) return;
                        const badge = document.createElement('span');
                        badge.className = `capability-badge capability-${tag}`;
                        badge.textContent = def.icon;
                        badge.setAttribute('data-tooltip', def.label);
                        badge.setAttribute('aria-label', def.label);
                        tagCont.appendChild(badge);
                    });
                }

                // Temporal Badge — always the last item in tag-container (pinned right via CSS)
                if (cfg.temporal) {
                    let badge = btn.querySelector('.temporal-badge');
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = `temporal-badge temporal-${cfg.temporal.toLowerCase().replace(/ /g, '-').replace(/\//g, '-').replace(/\+/g, 'plus')}`;
                        badge.textContent = cfg.temporal;

                        // Ensure a tag-container header row exists
                        let tagCont = btn.querySelector('.tag-container');
                        if (!tagCont) {
                            tagCont = document.createElement('div');
                            tagCont.className = 'tag-container';
                            btn.insertBefore(tagCont, btn.firstChild);
                        }
                        tagCont.appendChild(badge);
                    }
                }
            }
        }

        btn.addEventListener('click', (e) => {
            if (e.currentTarget.disabled || !isIndexProviderReady(e.currentTarget.dataset.index)) {
                enforceCogIndexSupport();
                setCogUiAvailability();
                return;
            }
            document.querySelectorAll('.index-btn').forEach(b => b.classList.remove('active'));
            let target = e.currentTarget;
            target.classList.add('active');
            target.setAttribute('aria-checked', 'true');
            state.activeIndex = target.dataset.index;
            
            // Render Dynamic Bookmarks for this standard index
            renderSpillBookmarks(state.activeIndex);
            updateWorkflowSummary();
            markActiveWorkflowControls();
            applyIndex();
        });
    });

    const primaryCompare = document.getElementById('btn-primary-compare');
    if (primaryCompare) {
        primaryCompare.addEventListener('click', () => {
            document.querySelector('.ui-mode-btn[data-layout="suite-grid"]')?.click();
            document.querySelector('.tab-btn[data-tab="analysis"]')?.click();
            document.getElementById('mode-compare')?.click();
            document.getElementById('btn-swipe')?.click();
        });
    }

    // Location Buttons
    document.querySelectorAll('.loc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.loc-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-checked', 'false');
            });
            let target = e.currentTarget;
            target.classList.add('active');
            target.setAttribute('aria-checked', 'true');
            let key = target.dataset.loc;
            state.activeLoc = key;
            const loc = AOI_LOCATIONS[key];

            document.getElementById('disp-lat').innerText = loc.lat.toFixed(4) + '°';
            document.getElementById('disp-lng').innerText = loc.lng.toFixed(4) + '°';

            state.map.flyTo([loc.lat, loc.lng], loc.zoom, { duration: 1.5 });
            document.getElementById('loc-search-input').value = '';
            clearSearchMarker(); // Preset AOIs aren't manually entered coords

            // Re-probe acquisitions for the new view
            setTimeout(() => probeAcquisitions(), 1600);
        });
    });

    // Spill Bookmarks are now rendered dynamically based on selected index

    // Custom Location Search
    const searchBtn = document.getElementById('btn-search-loc');
    const searchInput = document.getElementById('loc-search-input');

    function clearSearchMarker() {
        if (state.searchMarker) {
            state.map.removeLayer(state.searchMarker);
            state.searchMarker = null;
        }
    }

    function showSearchMarker(lat, lng, label) {
        clearSearchMarker();
        state.searchMarker = L.circleMarker([lat, lng], {
            radius: 9,
            color: '#fff',
            weight: 2,
            fillColor: '#00D2FF',
            fillOpacity: 0.9,
            className: 'pulse-marker'
        }).addTo(state.map);
        state.searchMarker.bindTooltip(label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, {
            direction: 'top',
            opacity: 0.95
        });
    }

    const handleLocationSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) return;

        searchBtn.innerText = '...';
        searchBtn.disabled = true;

        try {
            // Check if it's already coordinates: "31.55, -103.95" or "31.55 -103.95"
            // Matches optional minus, digits, period, optional space/comma
            const coordRegex = /^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/;
            const match = query.match(coordRegex);

            let lat, lng;

            if (match) {
                // Direct coordinates
                lat = parseFloat(match[1]);
                lng = parseFloat(match[2]);
            } else {
                // Name lookup via Nominatim
                const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
                const data = await resp.json();

                if (!data || data.length === 0) {
                    showToast("Location not found. Please try a different name or enter exactly 'lat, lng'.", 'warning');
                    throw new Error("Geocode failed");
                }

                lat = parseFloat(data[0].lat);
                lng = parseFloat(data[0].lon);
            }

            // Deselect presets
            document.querySelectorAll('.loc-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-checked', 'false');
            });
            state.activeLoc = 'custom';

            document.getElementById('disp-lat').innerText = lat.toFixed(4) + '°';
            document.getElementById('disp-lng').innerText = lng.toFixed(4) + '°';

            // Fly to the new location and mark it
            state.map.flyTo([lat, lng], 14, { duration: 1.5 });
            showSearchMarker(lat, lng, match ? null : query);

        } catch (err) {
            console.error("Location search error:", err);
        } finally {
            searchBtn.innerText = 'GO';
            searchBtn.disabled = false;
        }
    };

    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', handleLocationSearch);
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLocationSearch();
        });
    }

    // Base Layer Buttons
    document.querySelectorAll('.layer-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.layer-toggle').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            let target = e.currentTarget;
            target.classList.add('active');
            target.setAttribute('aria-pressed', 'true');

            const lKey = target.dataset.layer;
            state.map.removeLayer(state.baseLayerInst);
            state.baseLayerInst = L.tileLayer(BASE_LAYERS[lKey], { maxZoom: 18 }).addTo(state.map);
            state.baseLayerInst.bringToBack();
            updateEvidenceConfounderControl();
        });
    });

    // Data Fusion & HLS Toggles
    const toggleSar = document.getElementById('toggle-sar-fusion');
    if (toggleSar) {
        toggleSar.addEventListener('change', (e) => {
            state.sarFusion = e.target.checked;
            applyIndex();
        });
    }

    const sentinelToggle = document.getElementById('toggle-sentinel-live');
    if (sentinelToggle) {
        sentinelToggle.addEventListener('change', (e) => {
            if (isSentinelOnlyShareMode()) {
                runtimeImageProviderOverride = 'sentinelhub';
                state.sentinelLiveTiles = true;
                e.target.checked = true;
                updateSentinelGuardUI();
                applyIndex();
                return;
            }
            if (e.target.checked) {
                runtimeImageProviderOverride = 'sentinelhub';
                state.sentinelLiveTiles = true;
            } else {
                if (runtimeImageProviderOverride === 'sentinelhub') runtimeImageProviderOverride = null;
                state.sentinelLiveTiles = false;
            }
            updateSentinelGuardUI();
            setCogUiAvailability();
            renderSpillBookmarks(state.activeIndex);
            applyIndex();
        });
    }

    const sentinelZoom = document.getElementById('sentinel-min-zoom');
    if (sentinelZoom) {
        sentinelZoom.addEventListener('input', (e) => {
            state.sentinelMinZoom = Number(e.target.value);
            updateSentinelGuardUI();
        });
        sentinelZoom.addEventListener('change', () => {
            updateSentinelGuardUI();
            if (getActiveProvider() === 'sentinelhub') applyIndex();
        });
    }



    // RRC Spill Overlay Toggle
    const toggleRrc = document.getElementById('toggle-rrc-spills');
    if (toggleRrc) {
        toggleRrc.addEventListener('change', (e) => {
            if (e.target.checked) {
                initRrcSpillOverlay();
            } else {
                if (state.rrcSpillLayer) {
                    state.map.removeLayer(state.rrcSpillLayer);
                    state.rrcSpillLayer = null;
                }
                const badge = document.getElementById('rrc-spill-count');
                if (badge) badge.style.display = 'none';
            }
        });
    }


    // Single Date Dropdown
    const dateSingleEl = document.getElementById('date-single');
    if (dateSingleEl) {
        dateSingleEl.addEventListener('change', (e) => {
            state.monthIndex = parseInt(e.target.value, 10);
            state.activeEvidenceStage = '';
            state.activeEvidenceComparison = '';
            renderSpillEvidenceTimeline();
            if (state.mode === 'single') applyIndex();
        });
    }

    // Trendline Toggle
    const toggleTrendline = document.getElementById('toggle-trendline');
    if (toggleTrendline) {
        toggleTrendline.addEventListener('change', (e) => {
            if (reportChartInst && reportChartInst.data.datasets.length > 0) {
                // The smoothed trend is at index 0
                reportChartInst.data.datasets[0].hidden = !e.target.checked;
                reportChartInst.update();
            }
        });
    }

    const opSlider = document.getElementById('opacity-slider');
    const opSliderFill = document.getElementById('opacity-slider-fill');
    opSlider.addEventListener('input', (e) => {
        state.opacity = parseInt(e.target.value) / 100;

        if (opSliderFill) {
            opSliderFill.style.width = `${e.target.value}%`;
        }

        const setOp = (layer) => { if (layer && layer.setOpacity) layer.setOpacity(state.opacity); };
        if (state.overlayGroup) state.overlayGroup.eachLayer(setOp);
        if (state.leftGroup) state.leftGroup.eachLayer(setOp);
        if (state.rightGroup) state.rightGroup.eachLayer(setOp);
    });

    // Visual filter (threshold mask) slider
    const vfSlider = document.getElementById('visual-filter-slider');
    const vfVal = document.getElementById('visual-filter-val');
    if (vfSlider) {
        let vfDebounce = null;
        vfSlider.addEventListener('input', (e) => {
            const pct = parseInt(e.target.value);
            // Map 0–100 slider pct to the 0.0–1.0 range used by VISUAL_FILTER in evalscripts
            state.visualFilter = pct / 100;
            if (vfVal) vfVal.textContent = pct === 0 ? 'Off' : pct + '%';
            // Debounce applyIndex calls — tile re-fetch is expensive
            clearTimeout(vfDebounce);
            vfDebounce = setTimeout(() => applyIndex(), 400);
        });
    }
    // Detection sensitivity slider
    const sensSlider = document.getElementById('sensitivity-slider');
    const sensVal = document.getElementById('sensitivity-val');
    if (sensSlider) {
        let sensDebounce = null;
        sensSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.sensitivity = val;
            if (sensVal) {
                if (val === 0) sensVal.textContent = 'Baseline';
                else if (val > 0) sensVal.textContent = '+' + val + '%';
                else sensVal.textContent = val + '%';
            }
            clearTimeout(sensDebounce);
            sensDebounce = setTimeout(() => applyIndex(), 400);
        });
    }

    // Basin Calibration Toggle
    const basinSelect = document.getElementById('basin-select');
    if (basinSelect) {
        basinSelect.addEventListener('change', (e) => {
            state.activeBasin = e.target.value;
            applyIndex();
        });
    }

    // Compare Dates
    document.getElementById('date-t1').addEventListener('change', () => {
        state.activeEvidenceComparison = '';
        renderSpillEvidenceTimeline();
        if (state.mode === 'compare') applyIndex();
    });
    document.getElementById('date-t2').addEventListener('change', () => {
        state.activeEvidenceComparison = '';
        renderSpillEvidenceTimeline();
        if (state.mode === 'compare') applyIndex();
    });


    // Map Mouse Move for exact coordinate tracking (optional enhancement)
    state.map.on('mousemove', function (e) {
        document.getElementById('disp-lat').innerText = e.latlng.lat.toFixed(4) + '°';
        document.getElementById('disp-lng').innerText = e.latlng.lng.toFixed(4) + '°';
    });

    // ==========================================================================
    // Report & AOI Logic
    // ==========================================================================

    state.drawnItems = new L.FeatureGroup();
    state.map.addLayer(state.drawnItems);

    let drawRect = new L.Draw.Rectangle(state.map, {
        shapeOptions: {
            color: '#1C85A6',
            weight: 2,
            fillOpacity: 0.1
        }
    });

    let drawPoly = new L.Draw.Polygon(state.map, {
        allowIntersection: false,
        showArea: true,
        shapeOptions: {
            color: '#FF8F00',
            weight: 2,
            fillOpacity: 0.1
        }
    });

    document.getElementById('btn-draw-aoi').addEventListener('click', () => {
        state.drawnItems.clearLayers();
        window.aoiDrawnItem = null;
        updateAnalyticsControlAvailability();
        drawPoly.disable();
        drawRect.enable();
    });

    document.getElementById('btn-draw-poly').addEventListener('click', () => {
        state.drawnItems.clearLayers();
        window.aoiDrawnItem = null;
        updateAnalyticsControlAvailability();
        drawRect.disable();
        drawPoly.enable();
    });

    state.map.on(L.Draw.Event.CREATED, function (e) {
        let layer = e.layer;
        state.drawnItems.addLayer(layer);
        window.aoiDrawnItem = layer;
        updateAnalyticsControlAvailability();
    });

    document.getElementById('btn-scan-aoi').addEventListener('click', async () => {
        if (isGeeProviderActive()) {
            sentinelFeatureUnavailable('AOI history scan');
            return;
        }
        if (!aoiDrawnItem) {
            showToast("Please draw an Area of Interest (Rectangle or Polygon) first.", 'warning');
            return;
        }

        const btn = document.getElementById('btn-scan-aoi');
        const originalText = btn.innerText;
        btn.innerText = "Scanning 1-Year History...";
        btn.disabled = true;

        try {
            // 1. Setup Temporal Range
            const endDate = new Date();
            const startDate = new Date();
            startDate.setUTCFullYear(startDate.getUTCFullYear() - 1); // 1 Year lookback

            // 2. Setup Evalscript
            // The scanner checks: PWI, HPWI, PWOI (primary spill composites) and NDMI, NDWI, SAVI (env)
            const cal = CALIBRATION_PRESETS[state.activeBasin || 'permian'];
            const pwiLogic = INDICES.pwi.fisLogic
                .replace(/__BSI_MASK__/g, cal.bsiMask)
                .replace(/__PWI_SALINITY_OFFSET__/g, cal.pwiSalinityOffset)
                .replace(/__PWI_HC_OFFSET__/g, cal.pwiHydrocarbonOffset)
                .replace(/__PWI_HMRI_OFFSET__/g, cal.pwiHmriOffset);

            const fisScript = `//VERSION=3
const DETECTION_SENSITIVITY = ${state.sensitivity / 100};
function setup() {
  return {
    input: ["B02", "B03", "B04", "B05", "B07", "B08", "B11", "B12", "B8A", "SCL", "dataMask"],
    output: [
      { id: "default", bands: 10, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1, sampleType: "UINT8" }
    ]
  };
}
function evaluatePixel(sample) {
  const clearPixel = sample.SCL === 4 || sample.SCL === 5 || sample.SCL === 6 || sample.SCL === 7;
  if (sample.dataMask === 0 || !clearPixel) return { default: [NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN], dataMask: [0] };

  // Shared intermediates
  let ndsiSum = sample.B11 + sample.B12;
  let ndsi = ndsiSum === 0 ? 0 : (sample.B11 - sample.B12) / ndsiSum;
  let ndviSum = sample.B08 + sample.B04;
  let ndvi = ndviSum === 0 ? 0 : (sample.B08 - sample.B04) / ndviSum;
  let hcaiSum = sample.B11 + sample.B04;
  let hcai = hcaiSum === 0 ? 0 : (sample.B11 - sample.B04) / hcaiSum;
  let bsiNum = (sample.B11 + sample.B04) - (sample.B08 + sample.B02);
  let bsiDen = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
  let bsi = bsiDen === 0 ? 0 : bsiNum / bsiDen;
  let hmri = sample.B03 === 0 ? 0 : sample.B12 / sample.B03;

  // B0: PWI
  let val_pwi = (function() { ${pwiLogic} })()[0];

  // B1: HPWI
  let sumNdoi = sample.B02 + sample.B12;
  let ndoi = sumNdoi === 0 ? 0 : Math.max(0, (sample.B02 - sample.B12) / sumNdoi);
  let brineBoost = Math.max(0, ndsi - 0.03) * 0.8;
  let chemSignal = Math.min(1, ndoi + brineBoost);
  let sumSmooth = sample.B03 + sample.B11;
  let smooth = sumSmooth === 0 ? 0 : Math.max(0, Math.min(1, ((sample.B03 - sample.B11)/sumSmooth + 0.3) / 0.6));
  let val_hpwi = Math.min(1, chemSignal * smooth * 6.0);

  // B2: PWOI — optical proxy composite (reuses sumSmooth and ndsiSum from shared intermediates)
  let apexOVal = sumSmooth === 0 ? 0 : (sample.B03 - sample.B11) / sumSmooth;
  let apexRadarProxy = Math.max(0, Math.min(1.2, (apexOVal + 0.3) / 0.6));
  let apexBrineBoost = ndsiSum === 0 ? 0 : Math.max(0, (sample.B11 - sample.B12) / ndsiSum) * 0.4;
  let apexMoisture = apexOVal + 0.3 + apexBrineBoost;
  let val_apex = Math.min(Math.max(
      (apexRadarProxy > 0.7 && apexMoisture > 0.45)
          ? (apexRadarProxy * 0.4 + apexMoisture * 0.6 + 0.25)
          : (apexRadarProxy * 0.3 + apexMoisture * 0.7),
      0), 1);

  // B3: NDMI
  let sum_ndmi = sample.B8A + sample.B11;
  let val_ndmi = sum_ndmi === 0 ? NaN : (sample.B8A - sample.B11) / sum_ndmi;

  // B4: NDWI
  let sum_ndwi = sample.B03 + sample.B11;
  let val_ndwi = sum_ndwi === 0 ? NaN : (sample.B03 - sample.B11) / sum_ndwi;

  // B5: SAVI
  let val_savi = ((sample.B08 - sample.B04) / (ndviSum + 0.5)) * 1.5;

  // B6: VSI — Veg Stress Index (S2 only, real)
  let redEdgeSum = sample.B07 + sample.B05;
  let redEdgeDelta = redEdgeSum === 0 ? 0 : (sample.B07 - sample.B05) / redEdgeSum;
  let msi = sample.B8A === 0 ? 0 : sample.B11 / sample.B8A;
  let val_vsi = Math.max(0, ndsi) * Math.max(0, 0.4 - redEdgeDelta) * Math.max(0, msi - 1.0) * 10.0;

  // B7: TRI — Toxic Residue Index (S2 only, real)
  let aoi = (sample.B02 === 0 || sample.B12 === 0) ? 0 : (sample.B04 / sample.B02) * (sample.B11 / sample.B12);
  let val_tri = Math.max(0, ndsi - 0.05) * Math.max(0, (hmri - 1.5) / 2) * Math.max(0, (aoi - 1.5) / 2) * 10;

  // B8: BPI — Brine-Pavement Index (S2 only, real)
  let val_bpi = Math.max(0, bsi) * Math.max(0, ndsi - 0.03) * Math.max(0, hcai - 0.15) * 30.0;

  // B9: LBI — Liquid/Salinity Response Index (S2 only, real)
  let ndwi_lbi = sum_ndwi === 0 ? 0 : (sample.B03 - sample.B11) / sum_ndwi;
  let val_lbi = bsi <= -0.25 ? 0 : Math.max(0, ndsi - 0.02) * Math.max(0, ndwi_lbi + 0.40) * Math.max(0, 0.45 - ndvi) * Math.max(0, bsi + 0.20) * 20.0;

  return { default: [val_pwi, val_hpwi, val_apex, val_ndmi, val_ndwi, val_savi, val_vsi, val_tri, val_bpi, val_lbi], dataMask: [1] };
}`;

            const geojson = aoiDrawnItem.toGeoJSON();
            const statsPayload = {
                input: {
                    bounds: { geometry: geojson.geometry },
                    data: [{
                        type: "sentinel-2-l2a",
                        dataFilter: {
                            timeRange: { from: startDate.toISOString(), to: endDate.toISOString() },
                            mosaickingOrder: "mostRecent",
                            maxCloudCoverage: 100
                        }
                    }]
                },
                aggregation: {
                    timeRange: { from: startDate.toISOString(), to: endDate.toISOString() },
                    aggregationInterval: { of: "P5D" },
                    evalscript: fisScript,
                    resolution: 60
                }
            };

            const token = await getCDSEToken();
            const resp = await fetch(SH_STAT_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(statsPayload)
            });

            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(`Statistical API failed: ${errText}`);
            }

            const data = await resp.json();

            // Clear existing anomalies
            state.anomalousDates = [];

            // Define "Danger" Thresholds (modified by sensitivity)
            const THRESHOLDS = {
                pwi: 0.10 - (state.sensitivity / 100 * 0.2),
                lbi: 0.08,
                ndmi_spike: 0.35,
                ndsi: 0.15 - (state.sensitivity / 100 * 0.1)
            };

            const timelineLabels = [];
            const timelineData = { 
                pwi: [], hpwi: [], pwoi: [], lbi: [], // Primary
                vsi: [], scri: [], tri: [], bpi: [], // Secondary Effective
                ndmi: [], ndwi: [] // Standard/Env for rules
            };

            if (data.data) {
                data.data.forEach(interval => {
                    let dateStr = interval.interval.from.slice(0, 10);
                    timelineLabels.push(dateStr);
                    let bandsObj = interval.outputs?.default?.bands;
                    if (bandsObj && bandsObj.B0 && bandsObj.B0.stats.sampleCount > 0) {
                        let pwi  = bandsObj.B0.stats.mean;
                        let hpwi = bandsObj.B1.stats.mean;
                        let pwoi = bandsObj.B2.stats.mean;
                        let ndmi = bandsObj.B3.stats.mean;
                        let ndwi = bandsObj.B4.stats.mean;
                        // B5 (SAVI) used only for internal rules, not charted directly
                        let savi = bandsObj.B5.stats.mean;
                        let vsi  = bandsObj.B6.stats.mean;
                        let tri  = bandsObj.B7.stats.mean;
                        let bpi  = bandsObj.B8.stats.mean;
                        let lbi  = bandsObj.B9.stats.mean;

                        timelineData.pwi.push(pwi);
                        timelineData.hpwi.push(hpwi);
                        timelineData.pwoi.push(pwoi);
                        timelineData.lbi.push(lbi);
                        timelineData.vsi.push(vsi);
                        timelineData.scri.push(null); // SAR-only index; not computable from S2 scan
                        timelineData.tri.push(tri);
                        timelineData.bpi.push(bpi);
                        timelineData.ndmi.push(ndmi);
                        timelineData.ndwi.push(ndwi);

                        // Rule Engine: Flag if PWI spikes OR if there's a strong Spill signature (HPWI/PWOI)
                        if ((pwi  > THRESHOLDS.pwi) ||
                            (hpwi > 0.05) ||
                            (pwoi > 0.05) ||
                            (lbi  > THRESHOLDS.lbi) ||
                            (tri  > 0.05) ||
                            (bpi  > 0.05) ||
                            (ndmi > THRESHOLDS.ndmi_spike && ndwi < 0.1)) {
                            state.anomalousDates.push(dateStr);
                        }
                    } else {
                        Object.keys(timelineData).forEach(k => timelineData[k].push(null));
                    }
                });
            }

            // Render Sidebar Trend Charts
            updateTrendCharts(timelineLabels, timelineData);

            // Render Thumbnails for top anomalies
            if (state.anomalousDates.length > 0) {
                renderScanThumbnails(state.anomalousDates, aoiDrawnItem.getBounds());
            } else {
                const gallery = document.getElementById('scan-thumbnail-gallery');
                if (gallery) gallery.style.display = 'none';
            }

            if (state.anomalousDates.length > 0) {
                showToast(`Scan Complete: ${state.anomalousDates.length} hazardous dates identified`, 'warning');
            } else {
                showToast('Scan Complete: No major anomalies detected', 'success');
            }

            // Re-render UI to show highlights
            highlightAnomalies();

            // Pre-fetch highlight images for the top anomaly dates so hover is instant
            if (state.anomalousDates.length > 0 && state.drawnItems && state.drawnItems.getLayers().length > 0) {
                const prefetchBounds = state.drawnItems.getBounds();
                // Prefetch for the primary indices (PWI and HPWI)
                prefetchHighlights(state.anomalousDates, 'pwi', prefetchBounds);
                prefetchHighlights(state.anomalousDates, 'hpwi', prefetchBounds);
            }

        } catch (err) {
            console.error("Anomaly scan failed", err);
            showToast("Anomaly Scan failed. Check browser console for details.", 'warning');
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    });

    function updateTrendCharts(labels, dataset) {
        const panel = document.getElementById('bottom-chart-panel');
        if (!panel) return;
        panel.style.display = 'flex';

        // 1. Primary Chart
        const ctxPrimary = document.getElementById('primaryTrendChart').getContext('2d');
        if (state.primaryChart) state.primaryChart.destroy();

        state.primaryChart = new Chart(ctxPrimary, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'OBEC', data: dataset.hpwi, borderColor: '#f1c40f', pointBackgroundColor: '#f1c40f', pointBorderColor: '#f1c40f', backgroundColor: '#f1c40f', tension: 0.3, pointRadius: 2 },
                    { label: 'PWCI', data: dataset.pwi, borderColor: '#00D2FF', pointBackgroundColor: '#00D2FF', pointBorderColor: '#00D2FF', backgroundColor: '#00D2FF', tension: 0.3, pointRadius: 2 },
                    { label: 'LBI', data: dataset.lbi, borderColor: '#00D2FF', pointBackgroundColor: '#00D2FF', pointBorderColor: '#00D2FF', backgroundColor: '#00D2FF', borderDash: [2, 2], tension: 0.3, pointRadius: 2 },
                    { label: 'ASAI', data: dataset.pwoi, borderColor: '#8C00FF', pointBackgroundColor: '#8C00FF', pointBorderColor: '#8C00FF', backgroundColor: '#8C00FF', tension: 0.3, pointRadius: 2 }
                ]
            },
            options: getChartOptions(labels, 'Primary Indices')
        });

        // 2. Secondary Chart
        const ctxSecondary = document.getElementById('secondaryTrendChart').getContext('2d');
        if (state.secondaryChart) state.secondaryChart.destroy();

        state.secondaryChart = new Chart(ctxSecondary, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'VSI', data: dataset.vsi, borderColor: '#FFD700', pointBackgroundColor: '#FFD700', pointBorderColor: '#FFD700', backgroundColor: '#FFD700', tension: 0.3, pointRadius: 2 },
                    { label: 'SCRI', data: dataset.scri, borderColor: '#FF4500', pointBackgroundColor: '#FF4500', pointBorderColor: '#FF4500', backgroundColor: '#FF4500', tension: 0.3, pointRadius: 2 },
                    { label: 'TRI', data: dataset.tri, borderColor: '#9933ff', pointBackgroundColor: '#9933ff', pointBorderColor: '#9933ff', backgroundColor: '#9933ff', tension: 0.3, pointRadius: 2 },
                    { label: 'BPI', data: dataset.bpi, borderColor: '#00FFFF', pointBackgroundColor: '#00FFFF', pointBorderColor: '#00FFFF', backgroundColor: '#00FFFF', tension: 0.3, pointRadius: 2 }
                ]
            },
            options: getChartOptions(labels, 'Secondary Effective / Forensic')
        });
    }

    function getChartOptions(labels, title) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            onHover: (event, elements, chart) => {
                if (elements.length > 0) {
                    const nearest = chart.getElementsAtEventForMode(event, 'nearest', { intersect: false }, false);
                    if (nearest.length > 0) {
                        const idx = nearest[0].index;
                        const date = labels[idx];
                        const datasetIdx = nearest[0].datasetIndex;
                        const label = chart.data.datasets[datasetIdx].label.toLowerCase();
                        const chartValue = chart.data.datasets[datasetIdx].data[idx];
                        
                        // Trigger map highlight
                        showHoverHighlight(date, label, chartValue);
                    }
                } else {
                    hideHoverHighlight();
                }
            },
            onClick: (event, elements, chart) => {
                if (elements.length > 0) {
                    const nearest = chart.getElementsAtEventForMode(event, 'nearest', { intersect: false }, false);
                    if (nearest.length > 0) {
                        const index = nearest[0].index;
                        const dateStr = labels[index];

                        // Switch the active index to match the clicked dataset
                        const datasetIdx = nearest[0].datasetIndex;
                        const clickedLabel = chart.data.datasets[datasetIdx].label.toLowerCase();
                        if (INDICES[clickedLabel]) {
                            state.activeIndex = clickedLabel;
                            updateWorkflowSummary();
                            // Update sidebar button highlight
                            document.querySelectorAll('.index-btn').forEach(b => {
                                b.classList.toggle('active', b.dataset.index === clickedLabel);
                            });
                            markActiveWorkflowControls();
                        }

                    const dateIdx = closestDateIndex(dateStr, state.validSentinelDates);
                    if (dateIdx != null) {
                        state.monthIndex = dateIdx;
                        const dateSingleEl = document.getElementById('date-single');
                        if (dateSingleEl) dateSingleEl.value = dateIdx;
                        if (state.mode !== 'single') {
                            state.mode = 'single';
                            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                            document.getElementById('mode-single').classList.add('active');
                            document.getElementById('single-time-container').style.display = 'block';
                            document.getElementById('compare-dates-container').style.display = 'none';
                        }
                        applyIndex();
                    }
                }
            }
        },
            plugins: {
                legend: {
                    display: true,
                    position: 'right',
                    onClick: (e, legendItem, legend) => {
                        const index = legendItem.datasetIndex;
                        const ci = legend.chart;
                        if (ci.isDatasetVisible(index)) {
                            ci.hide(index);
                            legendItem.hidden = true;
                        } else {
                            ci.show(index);
                            legendItem.hidden = false;
                        }
                    },
                    labels: { color: 'rgba(255,255,255,0.7)', font: { size: 9 }, boxWidth: 10, boxHeight: 10, usePointStyle: false }
                }
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 9 } } },
                x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 8 }, maxTicksLimit: 10 } }
            }
        };
    }

    function highlightAnomalies() {
        if (!state.anomalousDates || state.anomalousDates.length === 0) return;

        // Use a Set for O(1) lookups instead of Array.includes() on each option
        const anomalySet = new Set(state.anomalousDates);

        ['date-single', 'date-t1', 'date-t2'].forEach(selectId => {
            const selectEl = document.getElementById(selectId);
            if (selectEl) {
                Array.from(selectEl.options).forEach(opt => {
                    // date-single stores numeric array indices as values; resolve to date string
                    const dateStr = selectId === 'date-single'
                        ? (ALL_DATES[parseInt(opt.value, 10)] || {}).value
                        : opt.value;
                    if (dateStr && anomalySet.has(dateStr)) {
                        if (!opt.text.includes('⚠️')) {
                            opt.text = '⚠️ ' + opt.text;
                            opt.style.color = '#FF8F00';
                            opt.style.fontWeight = 'bold';
                        }
                    }
                });
            }
        });
    }

    document.getElementById('btn-generate-report').addEventListener('click', async () => {
        if (!aoiDrawnItem) return;
        if (isGeeProviderActive()) {
            sentinelFeatureUnavailable('Report generation');
            return;
        }
        try {

            // 1. Populate Text Metadata
            const idx = INDICES[state.activeIndex];
            document.getElementById('report-date-run').innerText = new Date().toLocaleString();

            let bounds = aoiDrawnItem.getBounds();
            const geojson = aoiDrawnItem.toGeoJSON();
            let bboxStr = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
            let bStr = `N: ${bounds.getNorth().toFixed(4)}°, S: ${bounds.getSouth().toFixed(4)}°, E: ${bounds.getEast().toFixed(4)}°, W: ${bounds.getWest().toFixed(4)}°`;
            document.getElementById('report-aoi-bounds').innerText = bStr;

            document.getElementById('report-index-name').innerText = `${idx.name} [${idx.sensor}]`;
            document.getElementById('report-math').innerText = idx.formula;
            document.getElementById('report-info').innerText = [
                idx.formulaStatus ? `Formula status: ${idx.formulaStatus}` : '',
                idx.validationStatus ? `Validation status: ${idx.validationStatus}` : '',
                idx.info || 'No additional scientific context available.',
            ].filter(Boolean).join('\n\n');

            if (state.mode === 'single') {
                document.getElementById('report-time').innerText = ALL_DATES[state.monthIndex].displayStr;
            } else {
                const d1 = document.getElementById('date-t1').value;
                const d2 = document.getElementById('date-t2').value;
                const t1Obj = ALL_DATES.find(d => d.value === d1);
                const t2Obj = ALL_DATES.find(d => d.value === d2);
                document.getElementById('report-time').innerText = `${t1Obj ? t1Obj.displayStr : d1} to ${t2Obj ? t2Obj.displayStr : d2} (Change Analysis)`;
            }

                let isOptical = ['tc', 'fc', 'swir_rgb'].includes(state.activeIndex);
            const btn = document.getElementById('btn-generate-report');
            const chartSection = document.querySelector('.report-chart');

            if (isOptical) {
                chartSection.style.display = 'none';
            } else {
                chartSection.style.display = 'block';

                // 2. Generate Real Statistical Data via FIS
                btn.innerText = "Querying Database...";
                btn.disabled = true;

                const isSar = state.activeIndex === 's1_sar';
                let extraBands = isSar ? [] : ['B8A', 'B11', 'B03', 'B12', 'SCL'];
                let allBands = [...new Set([...idx.fisBands, ...extraBands])];
                let bandsStr = allBands.map(b => `'${b}'`).join(', ');
                const isSpill = ['pwi', 'pwoi', 'hpwi', 'ehc', 'lbi', 'fbc', 'reai', 'vcbi', 'aoi', 'cma', 'hmi', 'phi', 'tri', 'bpi'].includes(state.activeIndex);
                const activeSensitivity = isSpill ? (state.sensitivity || 0) : 0;

                const fisScript = `//VERSION=3
const DETECTION_SENSITIVITY = ${activeSensitivity / 100};
function setup() {
  return {
    input: [${bandsStr}, "dataMask"],
    output: [
      { id: "default", bands: ${isSar ? 1 : 4}, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1, sampleType: "UINT8" }
    ]
  };
}
function evaluatePixel(sample) {
  let mask = sample.dataMask;
  const clearPixel = ${isSar ? 'true' : '(sample.SCL === 4 || sample.SCL === 5 || sample.SCL === 6 || sample.SCL === 7)'};
  if (mask === 0 || !clearPixel) return { default: ${isSar ? '[NaN]' : '[NaN, NaN, NaN, NaN]'}, dataMask: [0] };
  
  let val_active = (function() {
    ${idx.fisLogic}
  })()[0];

  ${isSar ? 'return { default: [val_active], dataMask: [1] };' : `
  let sum_ndmi = sample.B8A + sample.B11;
  let val_ndmi = sum_ndmi === 0 ? NaN : (sample.B8A - sample.B11) / sum_ndmi + 0.3;

  let sum_ndwi = sample.B03 + sample.B11;
  let val_ndwi = sum_ndwi === 0 ? NaN : (sample.B03 - sample.B11) / sum_ndwi + 0.3;

  let sum_ndsi = sample.B11 + sample.B12;
  let val_ndsi = sum_ndsi === 0 ? NaN : (sample.B11 - sample.B12) / sum_ndsi + 0.1;

  return { default: [val_active, val_ndmi, val_ndwi, val_ndsi], dataMask: [1] };
  `}
}`;

                // Determine Temporal Range
                let startD, endD, chartTitleLabel;

                if (state.mode === 'compare') {
                    let d1 = document.getElementById('date-t1').value;
                    let d2 = document.getElementById('date-t2').value;
                    if (d1 > d2) { const temp = d1; d1 = d2; d2 = temp; }
                    let d1D = new Date(d1);
                    let d2D = new Date(d2);
                    startD = new Date(Date.UTC(d1D.getUTCFullYear(), d1D.getUTCMonth() - 3, d1D.getUTCDate()));
                    endD = new Date(Date.UTC(d2D.getUTCFullYear(), d2D.getUTCMonth() + 3, d2D.getUTCDate()));
                    if (endD > today) endD = today;
                    chartTitleLabel = `Comparative T1/T2 Range`;
                } else {
                    let targetDateStr = ALL_DATES[state.monthIndex].value;
                    let sd = new Date(targetDateStr);
                    startD = new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth() - 6, sd.getUTCDate()));
                    endD = new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth() + 6, sd.getUTCDate()));
                    if (endD > today) endD = today;
                    chartTitleLabel = `Selected Date +/- 6 Months`;
                }

                const activeKey = state.activeIndex;
                const cfg = INDICES[activeKey];

                const bboxCoords = bboxStr.split(',').map(Number);
                const collectionType = activeKey === 's1_sar' ? 'sentinel-1-grd' : 'sentinel-2-l2a';

                const statsPayload = {
                    input: {
                        bounds: {
                            geometry: geojson.geometry
                        },
                        data: [{
                            type: collectionType,
                            dataFilter: {
                                timeRange: { from: startD.toISOString(), to: endD.toISOString() },
                                mosaickingOrder: "mostRecent"
                            }
                        }]
                    },
                    aggregation: {
                        timeRange: { from: startD.toISOString(), to: endD.toISOString() },
                        aggregationInterval: { of: "P5D" }, // Sample every 5 days for robust trendline
                        evalscript: fisScript,
                        resolution: 60
                    }
                };

                let reportMetadataHtml = '';

                // Fetch Scene Metadata & Weather Data helper
                const gatherContextData = async (dateStr, geom, tokenStr) => {
                    let ctxHtml = `<div style="border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 10px; margin-bottom: 10px;">
                        <h5 style="margin: 0 0 8px 0; color: #fff;">Context for ${dateStr}</h5>`;

                    try {
                        // 1. Sentinel Hub Catalog API
                        let dateStart = `${dateStr}T00:00:00Z`;
                        let dateEnd = `${dateStr}T23:59:59Z`;

                        // We use sentinel-2-l2a collection for metadata because S1 doesn't have cloud cover/sun angles
                        const catalogPayload = {
                            collections: ["sentinel-2-l2a"],
                            datetime: `${dateStart}/${dateEnd}`,
                            intersects: geom,
                            limit: 1
                        };

                        const catResp = await fetch('https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenStr}` },
                            body: JSON.stringify(catalogPayload)
                        });

                        if (catResp.ok) {
                            const catData = await catResp.json();
                            if (catData && catData.features && catData.features.length > 0) {
                                const props = catData.features[0].properties;
                                let cc = props['eo:cloud_cover'] !== undefined ? `${props['eo:cloud_cover'].toFixed(1)}%` : 'N/A';
                                let sunEl = props['view:sun_elevation'] !== undefined ? `${props['view:sun_elevation'].toFixed(1)}°` : 'N/A';
                                let sunAz = props['view:sun_azimuth'] !== undefined ? `${props['view:sun_azimuth'].toFixed(1)}°` : 'N/A';

                                ctxHtml += `<div style="margin-bottom: 5px;"><strong>Satellite Telemetry:</strong></div>
                                    <ul style="margin: 0 0 10px 0; padding-left: 20px;">
                                        <li>Cloud Cover: ${cc}</li>
                                        <li>Sun Elevation: ${sunEl}</li>
                                        <li>Sun Azimuth: ${sunAz}</li>
                                    </ul>`;
                            } else {
                                ctxHtml += `<p style="margin: 0 0 10px 0; font-style: italic;">No optical STAC metadata found for this exact date.</p>`;
                            }
                        }

                        // 2. Open-Meteo Historical API (Coordinates from Centroid)
                        // Simple centroid approximation from BBox for weather API
                        let centerLat = (bboxCoords[1] + bboxCoords[3]) / 2;
                        let centerLon = (bboxCoords[0] + bboxCoords[2]) / 2;

                        const meteoUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${centerLat}&longitude=${centerLon}&start_date=${dateStr}&end_date=${dateStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;

                        const wxResp = await fetch(meteoUrl);
                        if (wxResp.ok) {
                            const wxData = await wxResp.json();
                            if (wxData && wxData.daily) {
                                let tempMax = wxData.daily.temperature_2m_max[0];
                                let tempMin = wxData.daily.temperature_2m_min[0];
                                let precip = wxData.daily.precipitation_sum[0];

                                ctxHtml += `<div style="margin-bottom: 5px;"><strong>Ground Weather (Open-Meteo):</strong></div>
                                    <ul style="margin: 0; padding-left: 20px;">
                                        <li>Max Temp: ${tempMax !== null ? tempMax + '°C' : 'N/A'}</li>
                                        <li>Min Temp: ${tempMin !== null ? tempMin + '°C' : 'N/A'}</li>
                                        <li>Precipitation: ${precip !== null ? precip + 'mm' : 'N/A'}</li>
                                    </ul>`;
                            }
                        } else {
                            ctxHtml += `<p style="margin: 0; font-style: italic;">Weather data unavailable.</p>`;
                        }

                    } catch (err) {
                        ctxHtml += `<p style="color: #ff6b6b; margin:0;">Error loading context: ${err.message}</p>`;
                    }

                    ctxHtml += `</div>`;
                    return ctxHtml;
                };

                if (activeKey !== 's1_sar') {
                    statsPayload.input.data[0].dataFilter.maxCloudCoverage = 100;
                }

                btn.innerText = "Querying CDSE Analytics Hub...";
                try {
                    const token = await getCDSEToken();

                    // Fetch metadata in parallel with statistics
                    if (state.mode === 'single') {
                        let targetDateStr = ALL_DATES[state.monthIndex].value;
                        reportMetadataHtml = await gatherContextData(targetDateStr, geojson.geometry, token);
                    } else {
                        let d1 = document.getElementById('date-t1').value;
                        let d2 = document.getElementById('date-t2').value;
                        if (d1 > d2) { const temp = d1; d1 = d2; d2 = temp; }

                        let html1 = await gatherContextData(d1, geojson.geometry, token);
                        let html2 = await gatherContextData(d2, geojson.geometry, token);
                        reportMetadataHtml = html1 + html2;
                    }

                    const resp = await fetch(SH_STAT_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(statsPayload)
                    });

                    if (!resp.ok) {
                        const errPayload = await resp.text();
                        throw new Error(`CDSE API returned HTTP ${resp.status}: ${errPayload.substring(0, 150)}`);
                    }

                    const data = await resp.json();
                    let validData = {};
                    let rawRecordsCount = 0;

                    if (data.data) {
                        rawRecordsCount = data.data.length;
                        data.data.forEach(interval => {
                            let dateStr = interval.interval.from.slice(0, 10);
                            let bandsObj = interval.outputs?.default?.bands;
                            if (bandsObj && bandsObj.B0 && bandsObj.B0.stats.sampleCount > 0) {
                                let st0 = bandsObj.B0.stats;
                                if (st0.mean !== null && !isNaN(st0.mean)) {
                                    validData[dateStr] = {
                                        active: st0.mean,
                                        ndmi: bandsObj.B1?.stats?.mean ?? NaN,
                                        ndwi: bandsObj.B2?.stats?.mean ?? NaN,
                                        ndsi: bandsObj.B3?.stats?.mean ?? NaN
                                    };
                                }
                            }
                        });
                    }

                    let sortedDates = Object.keys(validData).sort((a, b) => new Date(a) - new Date(b));

                    if (sortedDates.length === 0) {
                        throw new Error(`Data Sparsity Error: CDSE Analytics Hub evaluated ${rawRecordsCount} time slices over the period, but 0 slices contained successfully computed index pixels for this AOI.`);
                    }

                    // 1. Interpolate '0' values (often false measurements/clouds for most indices)
                    let chartLabels = [];
                    let dataArr = [];
                    let ndmiArr = [];
                    let ndwiArr = [];
                    let ndsiArr = [];
                    let bsiArr = [];
                    let brineArr = [];

                    for (let i = 0; i < sortedDates.length; i++) {
                        let d = sortedDates[i];
                        let vals = validData[d];
                        let val = vals.active;

                        if (val === 0 || isNaN(val)) {
                            let leftVal = null, rightVal = null;
                            for (let j = i - 1; j >= 0; j--) {
                                if (validData[sortedDates[j]].active !== 0 && !isNaN(validData[sortedDates[j]].active)) { leftVal = validData[sortedDates[j]].active; break; }
                            }
                            for (let j = i + 1; j < sortedDates.length; j++) {
                                if (validData[sortedDates[j]].active !== 0 && !isNaN(validData[sortedDates[j]].active)) { rightVal = validData[sortedDates[j]].active; break; }
                            }
                            if (leftVal !== null && rightVal !== null) {
                                val = (leftVal + rightVal) / 2;
                            } else if (leftVal !== null) {
                                val = leftVal;
                            } else if (rightVal !== null) {
                                val = rightVal;
                            } else {
                                val = 0;
                            }
                        }

                        chartLabels.push(d.slice(0, 10)); // YYYY-MM-DD
                        dataArr.push(val);
                        ndmiArr.push(isNaN(vals.ndmi) ? null : vals.ndmi);
                        ndwiArr.push(isNaN(vals.ndwi) ? null : vals.ndwi);
                        ndsiArr.push(isNaN(vals.ndsi) ? null : vals.ndsi);
                    }

                    // 1.5 Secondary Smoothing (Detect anomalous sharp drops/outliers)
                    // If a point drops below 30% of the average of its immediate neighbors, 
                    // and those neighbors are reasonably elevated (e.g. > 0.05), we interpolate it.
                    let outliersSmoothed = 0;
                    for (let i = 1; i < dataArr.length - 1; i++) {
                        let prev = dataArr[i - 1];
                        let next = dataArr[i + 1];
                        let curr = dataArr[i];

                        let neighborAvg = (prev + next) / 2;

                        if (neighborAvg > 0.05) {
                            if (curr < (neighborAvg * 0.3)) {
                                dataArr[i] = neighborAvg; // Interpolate the outlier
                                outliersSmoothed++;
                            }
                        }
                    }

                    // 2. Metrics Calculation (Multi-Event Detection)
                    let leakEvents = [];
                    let isLeakActive = false;
                    let currentLeakStart = null;
                    let currentLeakMax = -Infinity;

                    let baseThreshold = 0.1; // Threshold for significant deviation

                    for (let i = 0; i < dataArr.length; i++) {
                        let val = dataArr[i];

                        if (!isLeakActive && val > baseThreshold) {
                            // Look back to find where it started rising
                            let startIdx = i;
                            while (startIdx > 0 && dataArr[startIdx - 1] < dataArr[startIdx] && dataArr[startIdx - 1] < baseThreshold) {
                                startIdx--;
                            }
                            isLeakActive = true;
                            currentLeakStart = chartLabels[startIdx];
                            currentLeakMax = val;
                        } else if (isLeakActive) {
                            if (val > currentLeakMax) {
                                currentLeakMax = val;
                            }

                            if (val < baseThreshold || i === dataArr.length - 1) {
                                // Leak ended
                                let endDate = (val < baseThreshold) ? chartLabels[i] : 'Ongoing';
                                leakEvents.push({
                                    start: currentLeakStart,
                                    end: endDate,
                                    max: currentLeakMax
                                });
                                isLeakActive = false;
                                currentLeakStart = null;
                                currentLeakMax = -Infinity;
                            }
                        }
                    }

                    // Update DOM Metrics Panel in LIVE app UI (not just export)
                    const metricPanel = document.getElementById('report-metrics-panel');
                    if (metricPanel) {
                        metricPanel.style.display = 'block';

                        let eventsContainer = document.getElementById('metric-leak-events');
                        if (eventsContainer) {
                            if (leakEvents.length === 0) {
                                eventsContainer.innerHTML = '<span style="color: var(--text-muted);">No significant anomalous events detected above baseline threshold.</span>';
                            } else {
                                let html = leakEvents.map((evt, idx) => `
                                    <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                        <strong style="color: var(--accent-orange);">Event ${idx + 1}:</strong> 
                                        <span style="font-family: var(--font-mono);">${evt.start}</span> to <span style="font-family: var(--font-mono);">${evt.end}</span><br>
                                        <span style="color: var(--text-muted); font-size: 11px;">Peak Severity: ${evt.max.toFixed(4)}</span>
                                    </div>
                                `).join('');

                                if (outliersSmoothed > 0) {
                                    html += `<div style="color: var(--text-dim); font-size: 10px; margin-top: 4px;">*Includes ${outliersSmoothed} interpolated outlier${outliersSmoothed > 1 ? 's' : ''}</div>`;
                                }
                                eventsContainer.innerHTML = html;
                            }
                        }
                    }

                    // Render Scanned Anomalies Screenshots
                    const anomaliesPanel = document.getElementById('report-scanned-anomalies-panel');
                    const anomaliesList = document.getElementById('scanned-anomalies-list');
                    if (state.anomalousDates && state.anomalousDates.length > 0) {
                        if (anomaliesPanel) anomaliesPanel.style.display = 'block';
                        if (anomaliesList) {
                            let anomalyHtml = '';
                            const anomalyConfig = getActiveConfig();
                            const anomalyWmsLayer = anomalyConfig.SH_WMS_LAYER || 'AGRICULTURE';
                            state.anomalousDates.forEach(dateStr => {
                                let tcScript = getScriptContent(anomalyConfig, 'tc', false, false, state);
                                let pwiScript = getScriptContent(anomalyConfig, 'pwi', false, false, state);

                                // To prevent blank/transparent images due to clouds or orbit gaps on specific days,
                                // we request a 10-day composite window around the anomaly date
                                let d = new Date(dateStr);
                                let start_d = new Date(d); start_d.setDate(d.getDate() - 5);
                                let end_d = new Date(d); end_d.setDate(d.getDate() + 5);
                                let timeWindow = `${start_d.toISOString().slice(0, 10)}/${end_d.toISOString().slice(0, 10)}`;

                                let tcUrl = `${SH_WMS_URL}?service=WMS&request=GetMap&version=1.3.0&layers=${anomalyWmsLayer}&format=image/jpeg&transparent=false&width=400&height=400&crs=CRS:84&bbox=${bboxStr}&time=${timeWindow}&maxcc=20&evalscript=${btoa(unescape(encodeURIComponent(tcScript)))}`;
                                let pwiUrl = `${SH_WMS_URL}?service=WMS&request=GetMap&version=1.3.0&layers=${anomalyWmsLayer}&format=image/png&transparent=true&width=400&height=400&crs=CRS:84&bbox=${bboxStr}&time=${timeWindow}&maxcc=20&evalscript=${btoa(unescape(encodeURIComponent(pwiScript)))}`;

                                anomalyHtml += `
                                <div style="position: relative; width: 100%; aspect-ratio: 1; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                                    <img src="${tcUrl}" style="position: absolute; top:0; left:0; width:100%; height:100%; object-fit: cover; background: #222;" alt="Base">
                                    <img src="${pwiUrl}" style="position: absolute; top:0; left:0; width:100%; height:100%; object-fit: cover; opacity: 0.85;" alt="PWI">
                                    <div style="position: absolute; bottom: 8px; left: 8px; background: rgba(0,0,0,0.8); border: 1px solid rgba(255,140,0,0.5); padding: 4px 8px; border-radius: 4px; color: var(--accent-orange); font-family: var(--font-mono); font-size: 11px; font-weight: bold;">
                                        ⚠️ ${dateStr}
                                    </div>
                                </div>
                                `;
                            });
                            anomaliesList.innerHTML = anomalyHtml;
                        }
                    } else {
                        if (anomaliesPanel) anomaliesPanel.style.display = 'none';
                        if (anomaliesList) anomaliesList.innerHTML = '';
                    }

                    // Mount Metadata HTML
                    const metaPanel = document.getElementById('report-metadata-panel');
                    if (metaPanel) {
                        metaPanel.style.display = 'block';
                        document.getElementById('metadata-content').innerHTML = reportMetadataHtml || '<p>Metadata gathering failed.</p>';
                    }

                    // Calculate Smoothed Trendline (3-point centered moving average)
                    let trendlineData = [];
                    for (let i = 0; i < dataArr.length; i++) {
                        let sum = 0;
                        let count = 0;
                        // Window of -1 to +1
                        for (let j = Math.max(0, i - 1); j <= Math.min(dataArr.length - 1, i + 1); j++) {
                            sum += dataArr[j];
                            count++;
                        }
                        trendlineData.push(sum / count);
                    }

                    const showTrend = document.getElementById('toggle-trendline') ? document.getElementById('toggle-trendline').checked : true;

                    let chartDatasets = [];

                    if (document.getElementById('toggle-trendline') && document.getElementById('toggle-trendline').checked) {
                        chartDatasets.push({
                            label: "Smoothed Trend",
                            data: trendlineData,
                            borderColor: '#FF8F00',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            fill: false,
                            tension: 0.4,
                            pointRadius: 0,
                            pointHitRadius: 10,
                            spanGaps: true,
                            order: 1
                        });
                    }

                    chartDatasets.push({
                        label: cfg.name,
                        data: dataArr,
                        borderColor: CHART_COLORS[activeKey] || '#ffffff',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        pointBackgroundColor: CHART_COLORS[activeKey] || '#ffffff',
                        pointBorderColor: CHART_COLORS[activeKey] || '#ffffff',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.1,
                        pointRadius: 3,
                        pointHitRadius: 10,
                        spanGaps: true,
                        order: 2
                    });

                    if (activeKey !== 's1_sar') {
                        if (activeKey !== 'ndmi') {
                            chartDatasets.push({
                                label: "Moisture Context (NDMI)",
                                data: ndmiArr,
                                borderColor: CHART_COLORS.ndmi,
                                backgroundColor: 'transparent',
                                pointBackgroundColor: CHART_COLORS.ndmi,
                                pointBorderColor: CHART_COLORS.ndmi,
                                borderWidth: 1.5,
                                borderDash: [5, 5],
                                fill: false,
                                tension: 0.3,
                                pointRadius: 1,
                                spanGaps: true,
                                order: 3,
                                hidden: true
                            });
                        }
                        if (activeKey !== 'ndwi') {
                            chartDatasets.push({
                                label: "Wetness Context (NDWI)",
                                data: ndwiArr,
                                borderColor: CHART_COLORS.ndwi,
                                backgroundColor: 'transparent',
                                pointBackgroundColor: CHART_COLORS.ndwi,
                                pointBorderColor: CHART_COLORS.ndwi,
                                borderWidth: 1.5,
                                borderDash: [5, 5],
                                fill: false,
                                tension: 0.3,
                                pointRadius: 1,
                                spanGaps: true,
                                order: 4,
                                hidden: true
                            });
                        }
                        if (activeKey !== 'ndsi') {
                            chartDatasets.push({
                                label: "Salinity Context (NDSI)",
                                data: ndsiArr,
                                borderColor: CHART_COLORS.ndsi,
                                backgroundColor: 'transparent',
                                pointBackgroundColor: CHART_COLORS.ndsi,
                                pointBorderColor: CHART_COLORS.ndsi,
                                borderWidth: 1.5,
                                borderDash: [5, 5],
                                fill: false,
                                tension: 0.3,
                                pointRadius: 1,
                                spanGaps: true,
                                order: 5,
                                hidden: true
                            });
                        }
                        // BSI context dataset removed — bsiArr was never populated from the stats API
                    }

                    document.querySelector('.report-chart h3').innerText = `Multivariate Statistical Trends (AOI Mean) - ${chartTitleLabel}`;

                    const ctx = document.getElementById('reportChart').getContext('2d');
                    if (reportChartInst) reportChartInst.destroy();

                    window.reportChartInst = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: chartLabels,
                            datasets: chartDatasets
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: {
                                mode: 'index',
                                intersect: false,
                            },
                            onHover: (event, elements, chart) => {
                                if (elements.length > 0) {
                                    const nearest = chart.getElementsAtEventForMode(event, 'nearest', { intersect: false }, false);
                                    if (nearest.length > 0) {
                                        const idx = nearest[0].index;
                                        const date = chartLabels[idx];
                                        const datasetIdx = nearest[0].datasetIndex;
                                        const rawLabel = chart.data.datasets[datasetIdx].label;
                                        
                                        // Parse index key from label (e.g. "Moisture Context (NDMI)" -> "ndmi")
                                        const match = rawLabel.match(/\(([^)]+)\)/);
                                        const indexKey = match ? match[1].toLowerCase() : rawLabel.toLowerCase();
                                        
                                        const chartValue = chart.data.datasets[datasetIdx].data[idx];
                                        
                                        showHoverHighlight(date, indexKey, chartValue);
                                    }
                                } else {
                                    hideHoverHighlight();
                                }
                            },
                            plugins: {
                                legend: {
                                    display: true,
                                    labels: { color: 'rgba(255,255,255,0.8)', usePointStyle: true, boxWidth: 8 }
                                },
                                tooltip: {
                                    callbacks: {
                                        title: (ctx) => {
                                            return ctx[0].label;
                                        }
                                    }
                                }
                            },
                            scales: {
                                y: {
                                    grid: { color: 'rgba(255,255,255,0.05)' },
                                    ticks: { color: 'rgba(255,255,255,0.5)' }
                                },
                                x: {
                                    grid: { color: 'rgba(255,255,255,0.05)' },
                                    ticks: { color: 'rgba(255,255,255,0.5)', maxRotation: 45, minRotation: 45, maxTicksLimit: 12 }
                                }
                            }
                        }
                    });

                } catch (e) {
                    console.error("Failed to fetch statistical timeline", e);
                    alert("Statistical rendering failed. See console.");
                    btn.innerText = "Generate Selected Report";
                    btn.disabled = false;
                    return;
                }
            }

            btn.innerText = "Generate Selected Report";
            btn.disabled = false;

            // 4. Show Maps in Modal
            const diffContainer = document.getElementById('report-map-diff-container');
            const mapLabel = document.getElementById('report-map-label');
            const mapWrapperSingle = document.getElementById('report-map');
            const mapWrapperCompare = document.getElementById('side-by-side-maps');

            let activeBaseKey = 'imagery';
            document.querySelectorAll('.layer-toggle').forEach(btn => {
                if (btn.classList.contains('active')) activeBaseKey = btn.dataset.layer;
            });

            // --- Primary map (imagery / T2 date) ---
            if (!reportMapInst) {
                window.reportMapInst = L.map('report-map', {
                    zoomControl: true, attributionControl: false,
                    dragging: false, scrollWheelZoom: false,
                    doubleClickZoom: false, keyboard: false
                });
                reportMapInst.baseLayer = L.tileLayer(BASE_LAYERS[activeBaseKey], { maxZoom: 18 }).addTo(reportMapInst);
            } else {
                if (reportMapInst.baseLayer) reportMapInst.removeLayer(reportMapInst.baseLayer);
                reportMapInst.baseLayer = L.tileLayer(BASE_LAYERS[activeBaseKey], { maxZoom: 18 }).addTo(reportMapInst);
            }

            let overlayLayer = null;
            let rd1Compare = null, rd2Compare = null;
            if (state.mode === 'single') {
                mapWrapperSingle.style.display = 'block';
                mapWrapperCompare.style.display = 'none';

                overlayLayer = getIndexLayer(state, getActiveConfig(), ALL_DATES[state.monthIndex].value, false);
                mapLabel.innerText = 'Area of Interest (AOI)';
                diffContainer.style.display = 'none';

                setTimeout(() => {
                    reportMapInst.invalidateSize();
                    reportMapInst.fitBounds(bounds, { padding: [20, 20] });

                    if (reportMapInst._drawnItems) reportMapInst._drawnItems.clearLayers();
                    else {
                        reportMapInst._drawnItems = new L.FeatureGroup();
                        reportMapInst.addLayer(reportMapInst._drawnItems);
                    }
                    L.geoJSON(geojson, {
                        style: { color: '#1C85A6', weight: 3, fillOpacity: 0.2 }
                    }).addTo(reportMapInst._drawnItems);

                    if (reportMapInst.overlayLayer) reportMapInst.removeLayer(reportMapInst.overlayLayer);
                    if (overlayLayer) reportMapInst.overlayLayer = overlayLayer.addTo(reportMapInst);
                }, 150);

            } else {
                rd1Compare = document.getElementById('date-t1').value;
                rd2Compare = document.getElementById('date-t2').value;
                if (rd1Compare > rd2Compare) { const tmp = rd1Compare; rd1Compare = rd2Compare; rd2Compare = tmp; }

                mapWrapperSingle.style.display = 'none';
                mapWrapperCompare.style.display = 'flex';
                mapLabel.innerText = `Side by Side: T1 (${rd1Compare}) vs T2 (${rd2Compare})`;
                diffContainer.style.display = 'block';

                setTimeout(() => {
                    // We recycle reportMapInst for T1, and reportDiffMapInst (or a new one) for T2
                    if (!window.reportMapInst) {
                        window.reportMapInst = L.map('report-map-t1', {
                            zoomControl: false, attributionControl: false,
                            dragging: false, scrollWheelZoom: false,
                            doubleClickZoom: false, keyboard: false
                        });
                    } else {
                        // map already exists, just reparent if needed
                        window.reportMapInst.remove();
                        window.reportMapInst = L.map('report-map-t1', {
                            zoomControl: false, attributionControl: false,
                            dragging: false, scrollWheelZoom: false,
                            doubleClickZoom: false, keyboard: false
                        });
                    }

                    if (window.reportMapInstT2) {
                        window.reportMapInstT2.remove();
                    }

                    window.reportMapInstT2 = L.map('report-map-t2', {
                        zoomControl: false, attributionControl: false,
                        dragging: false, scrollWheelZoom: false,
                        doubleClickZoom: false, keyboard: false
                    });

                    L.tileLayer(BASE_LAYERS[activeBaseKey], { maxZoom: 18 }).addTo(window.reportMapInst);
                    L.tileLayer(BASE_LAYERS[activeBaseKey], { maxZoom: 18 }).addTo(window.reportMapInstT2);

                    reportMapInst.invalidateSize();
                    window.reportMapInstT2.invalidateSize();

                    window.reportMapInst.fitBounds(bounds, { padding: [10, 10] });
                    window.reportMapInstT2.fitBounds(bounds, { padding: [10, 10] });

                    L.geoJSON(geojson, {
                        style: { color: '#1C85A6', weight: 3, fillOpacity: 0.2 }
                    }).addTo(window.reportMapInst);
                    L.geoJSON(geojson, {
                        style: { color: '#1C85A6', weight: 3, fillOpacity: 0.2 }
                    }).addTo(window.reportMapInstT2);

                    getIndexLayer(state, getActiveConfig(), rd1Compare, false).addTo(window.reportMapInst);
                    getIndexLayer(state, getActiveConfig(), rd2Compare, false).addTo(window.reportMapInstT2);

                    // Init diff map below side-by-side
                    if (!reportDiffMapInst) {
                        window.reportDiffMapInst = L.map('report-map-diff', {
                            zoomControl: false, attributionControl: false,
                            dragging: false, scrollWheelZoom: false,
                            doubleClickZoom: false, keyboard: false
                        });
                        reportDiffMapInst.baseLayer = L.tileLayer(BASE_LAYERS[activeBaseKey], { maxZoom: 18 }).addTo(reportDiffMapInst);
                    } else {
                        if (reportDiffMapInst.baseLayer) reportDiffMapInst.removeLayer(reportDiffMapInst.baseLayer);
                        reportDiffMapInst.baseLayer = L.tileLayer(BASE_LAYERS[activeBaseKey], { maxZoom: 18 }).addTo(reportDiffMapInst);
                    }

                    reportDiffMapInst.invalidateSize();
                    reportDiffMapInst.fitBounds(bounds, { padding: [20, 20] });

                    if (reportDiffMapInst._drawnItems) reportDiffMapInst._drawnItems.clearLayers();
                    else {
                        reportDiffMapInst._drawnItems = new L.FeatureGroup();
                        reportDiffMapInst.addLayer(reportDiffMapInst._drawnItems);
                    }
                    L.geoJSON(geojson, {
                        style: { color: '#FF8F00', weight: 3, fillOpacity: 0.15 }
                    }).addTo(reportDiffMapInst._drawnItems);

                    if (reportDiffMapInst.overlayLayer) reportDiffMapInst.removeLayer(reportDiffMapInst.overlayLayer);
                    reportDiffMapInst.overlayLayer = getIndexLayer(state, getActiveConfig(), `${rd1Compare}/${rd2Compare}`, true).addTo(reportDiffMapInst);
                }, 150);
            }

            // 3. Show Modal
            document.getElementById('report-modal').style.display = 'flex';

            // 5. Generate Animated GIF if Compare Mode
            const gifSection = document.getElementById('report-gif-section');
            if (state.mode === 'compare') {
                gifSection.style.display = 'block';

                const gifLoader = document.getElementById('gif-loader-text');
                const gifImgDiff = document.getElementById('report-gif-result-diff');
                const gifBtnDiff = document.getElementById('btn-download-gif-diff');
                const gifContDiff = document.getElementById('gif-container-diff');

                gifLoader.style.display = 'block';
                gifLoader.innerText = 'Calculating temporal frames...';

                let d1 = document.getElementById('date-t1').value;
                let d2 = document.getElementById('date-t2').value;
                if (d1 > d2) { const temp = d1; d1 = d2; d2 = temp; }

                const t1ObjIdx = ALL_DATES.findIndex(d => d.value === d1);
                const t2ObjIdx = ALL_DATES.findIndex(d => d.value === d2);

                // Build indices for max 12 frames
                let frameIndices = [];
                const steps = 12;
                if (t2ObjIdx - t1ObjIdx <= steps) {
                    for (let i = t1ObjIdx; i <= t2ObjIdx; i++) frameIndices.push(i);
                } else {
                    const stepRate = (t2ObjIdx - t1ObjIdx) / steps;
                    for (let i = 0; i < steps; i++) {
                        frameIndices.push(Math.round(t1ObjIdx + i * stepRate));
                    }
                    frameIndices.push(t2ObjIdx);
                    frameIndices = [...new Set(frameIndices)];
                }

                // Generate URLs
                const reportConfig = getActiveConfig();
                let wmsLayerParam = reportConfig.SH_WMS_LAYER || 'AGRICULTURE';
                if (state.activeIndex === 's1_sar') wmsLayerParam = 'SENTINEL1-GRD';

                const isDiffAnim = true; // Always build the Difference Heatmap GIF

                // Standard imagery GIF always uses True Color — reliable across all WMS time-range requests.
                // Index-specific visualization is the diff heatmap GIF's job.
                const safeB64 = (str) => btoa(unescape(encodeURIComponent(str)));
                const b64TcBg = state.activeIndex === 's1_sar' ? safeB64(getScriptContent(reportConfig, 's1_sar', false, false, state)) : safeB64(getScriptContent(reportConfig, 'tc', false, false, state));

                let diffB64Math = safeB64(getScriptContent(reportConfig, state.activeIndex, true, false, state));

                // Calculate dynamic GIF dimensions based on AOI aspect ratio to prevent squashing
                let latRad = bounds.getCenter().lat * Math.PI / 180;
                let aspect = (bounds.getEast() - bounds.getWest()) * Math.cos(latRad) / (bounds.getNorth() - bounds.getSouth());

                let gifW = 400;
                let gifH = Math.round(400 / aspect);
                if (gifH > 400) {
                    gifH = 400;
                    gifW = Math.round(400 * aspect);
                }
                gifW = Math.max(100, Math.floor(gifW));
                gifH = Math.max(100, Math.floor(gifH));
                let canvasH = gifH + 30; // +30 for footer

                // Generate Standard Imagery URLs (Backgrounds) — always TC, MAXCC=60 for good coverage
                const bgUrls = frameIndices.map(i => {
                    const dateStr = ALL_DATES[i].value;
                    let dPrior = new Date(dateStr);
                    dPrior.setUTCDate(dPrior.getUTCDate() - 20);
                    let pStr = dPrior.toISOString().split('T')[0];
                    let rangeStr = `${pStr}/${dateStr}`;
                    return `${SH_WMS_URL}?SERVICE=WMS&REQUEST=GetMap&LAYERS=${wmsLayerParam}&FORMAT=image/png&TRANSPARENT=false&VERSION=1.3.0&TIME=${rangeStr}&MAXCC=60&WIDTH=${gifW}&HEIGHT=${gifH}&CRS=CRS:84&BBOX=${bboxStr}&EVALSCRIPT=${encodeURIComponent(b64TcBg)}`;
                });

                // Generate Difference Mask URLs — capture-to-capture (each frame = change from previous frame)
                // Always generated now
                let diffUrls = frameIndices.map((idx, pos) => {
                    const currDateStr = ALL_DATES[idx].value;
                    // Previous frame for comparison (use T1 for first frame, previous frame date for rest)
                    const prevIdx = pos === 0 ? t1ObjIdx : frameIndices[pos - 1];
                    const prevDateStr = ALL_DATES[prevIdx].value;
                    // Small buffer: start a few days before prevDate for cloud avoidance
                    let dPrev = new Date(prevDateStr);
                    dPrev.setUTCDate(dPrev.getUTCDate() - 5);
                    let pBuffStr = dPrev.toISOString().split('T')[0];
                    let rangeStr = `${pBuffStr}/${currDateStr}`;
                    return `${SH_WMS_URL}?SERVICE=WMS&REQUEST=GetMap&LAYERS=${wmsLayerParam}&FORMAT=image/png&TRANSPARENT=true&VERSION=1.3.0&TIME=${rangeStr}&MAXCC=60&WIDTH=${gifW}&HEIGHT=${gifH}&CRS=CRS:84&BBOX=${bboxStr}&EVALSCRIPT=${encodeURIComponent(diffB64Math)}`;
                });

                gifLoader.innerText = `Fetching ${bgUrls.length * 2} satellite frames...`;

                // Canvas composite renderer helper
                const renderCanvas = (bgBlob, diffBlob, dateText, overlayAlpha = 1.0) => {
                    return new Promise((resolve) => {
                        const canvas = document.createElement('canvas');
                        canvas.width = gifW;
                        canvas.height = canvasH;
                        const ctx = canvas.getContext('2d');

                        const drawFooter = () => {
                            ctx.globalAlpha = 1.0;
                            ctx.fillStyle = '#111111';
                            ctx.fillRect(0, gifH, gifW, 30);
                            ctx.fillStyle = '#ffffff';
                            ctx.font = '600 13px sans-serif';
                            ctx.textBaseline = 'middle';
                            ctx.textAlign = 'center';
                            ctx.fillText(dateText, gifW / 2, gifH + 15);
                            resolve(canvas.toDataURL('image/jpeg', 0.95));
                        };

                        const drawDiffOverlay = () => {
                            if (!diffBlob) { drawFooter(); return; }
                            const diffUrl = URL.createObjectURL(diffBlob);
                            const dfImg = new Image();
                            dfImg.crossOrigin = 'Anonymous';
                            dfImg.onload = () => {
                                ctx.globalAlpha = overlayAlpha;
                                ctx.drawImage(dfImg, 0, 0, gifW, gifH);
                                ctx.globalAlpha = 1.0;
                                drawFooter();
                            };
                            dfImg.onerror = drawFooter;
                            dfImg.src = diffUrl;
                        };

                        if (!bgBlob) {
                            // Placeholder for frames where WMS returned no data
                            ctx.fillStyle = '#1a1c28';
                            ctx.fillRect(0, 0, gifW, gifH);
                            ctx.fillStyle = 'rgba(255,255,255,0.25)';
                            ctx.font = '13px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText('No imagery available', gifW / 2, gifH / 2);
                            drawDiffOverlay();
                            return;
                        }

                        const bgUrl = URL.createObjectURL(bgBlob);
                        const bgImg = new Image();
                        bgImg.crossOrigin = 'Anonymous';
                        bgImg.onload = () => { ctx.drawImage(bgImg, 0, 0, gifW, gifH); drawDiffOverlay(); };
                        bgImg.onerror = () => {
                            // Image bytes couldn't be decoded (probably WMS XML error) — show placeholder
                            ctx.fillStyle = '#1a1c28';
                            ctx.fillRect(0, 0, gifW, gifH);
                            ctx.fillStyle = 'rgba(255,255,255,0.25)';
                            ctx.font = '13px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText('No imagery available', gifW / 2, gifH / 2);
                            drawDiffOverlay();
                        };
                        bgImg.src = bgUrl;
                    });
                };

                const createGifPlayer = (frames, imgElem, btnElem, width, height) => {
                    gifshot.createGIF({
                        images: frames,
                        gifWidth: width,
                        gifHeight: height,
                        interval: 0.5,
                        numFrames: frames.length
                    }, (obj) => {
                        if (!obj.error) {
                            imgElem.src = obj.image;
                            btnElem.href = obj.image;
                            imgElem.style.display = 'block';
                        } else {
                            console.error("Gifshot error", obj.error);
                            imgElem.alt = "Failed to generate GIF";
                        }
                    });
                };

                const buildDiffGif = async (bgBlobs) => {
                    const diffBlobs = await Promise.all(diffUrls.map(u =>
                        fetch(u).then(r => r.ok ? r.blob() : null).catch(() => null)
                    ));
                    const canvases = await Promise.all(bgBlobs.map((b, i) => renderCanvas(b, diffBlobs[i], ALL_DATES[frameIndices[i]].displayStr)));
                    gifContDiff.style.display = 'block';
                    createGifPlayer(canvases, gifImgDiff, gifBtnDiff, gifW, canvasH);
                };

                const gifContIndex = document.getElementById('gif-container-index');
                const gifImgIndex = document.getElementById('report-gif-result-index');
                const gifBtnIndex = document.getElementById('btn-download-gif-index');
                const gifIndexTitle = document.getElementById('gif-index-title');
                const idxName = INDICES[state.activeIndex]?.name || state.activeIndex.toUpperCase();
                if (gifIndexTitle) gifIndexTitle.innerText = `${idxName} — Index Gradient`;

                // Build index-specific evalscript URLs (one per frame, single-date)
                const b64IndexScript = safeB64(getScriptContent(reportConfig, state.activeIndex, false, false, state));
                const indexUrls = frameIndices.map(i => {
                    const dateStr = ALL_DATES[i].value;
                    let dPrior = new Date(dateStr);
                    dPrior.setUTCDate(dPrior.getUTCDate() - 20);
                    let pStr = dPrior.toISOString().split('T')[0];
                    let rangeStr = `${pStr}/${dateStr}`;
                    // Set TRANSPARENT=true to allow base aerials to show underneath
                    return `${SH_WMS_URL}?SERVICE=WMS&REQUEST=GetMap&LAYERS=${wmsLayerParam}&FORMAT=image/png&TRANSPARENT=true&VERSION=1.3.0&TIME=${rangeStr}&MAXCC=60&WIDTH=${gifW}&HEIGHT=${gifH}&CRS=CRS:84&BBOX=${bboxStr}&EVALSCRIPT=${encodeURIComponent(b64IndexScript)}`;
                });

                const buildIndexGif = async (bgBlobs) => {
                    const indexBlobs = await Promise.all(indexUrls.map(u =>
                        fetch(u).then(r => r.ok ? r.blob() : null).catch(() => null)
                    ));
                    // 0.65 opacity overlay to see aerial below
                    const canvases = await Promise.all(bgBlobs.map((b, i) => renderCanvas(b, indexBlobs[i], ALL_DATES[frameIndices[i]].displayStr, 0.65)));
                    gifContIndex.style.display = 'block';
                    createGifPlayer(canvases, gifImgIndex, gifBtnIndex, gifW, canvasH);
                };

                (async () => {
                    try {
                        gifLoader.innerText = 'Pre-fetching Aerial Base Layers...';
                        const bgBlobs = await Promise.all(bgUrls.map(u =>
                            fetch(u).then(r => r.ok ? r.blob() : null).catch(() => null)
                        ));

                        gifLoader.innerText = `Encoding ${idxName} Index Gradient GIF...`;
                        await buildIndexGif(bgBlobs);

                        gifLoader.innerText = 'Encoding Difference Heatmap GIF...';
                        await buildDiffGif(bgBlobs);

                        gifLoader.style.display = 'none';
                    } catch (e) {
                        gifLoader.innerText = 'Failed to fetch or encode imagery for GIFs.';
                        console.error("GIF Render Error:", e);
                    }
                })();

            } else {
                gifSection.style.display = 'none';
            }
        } catch (fatal_err) {
            console.error(fatal_err);
            const errBtn = document.getElementById('btn-generate-report');
            errBtn.innerText = "Crash: " + fatal_err.message;
            errBtn.style.color = "red";
            errBtn.disabled = false;
        }

    });

    document.getElementById('btn-close-report').addEventListener('click', () => {
        document.getElementById('report-modal').style.display = 'none';
    });

    // UI Layout Mode Switcher Bindings
    const uiModeBtns = document.querySelectorAll('.ui-mode-btn');
    const uiLayoutPanes = document.querySelectorAll('.ui-layout-pane');
    
    uiModeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetLayout = e.currentTarget.dataset.layout;
            
            // Toggle active button state
            uiModeBtns.forEach(b => {
                const isActive = b.dataset.layout === targetLayout;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            
            // Toggle active pane visibility
            uiLayoutPanes.forEach(pane => {
                if (pane.id === `layout-pane-${targetLayout}`) {
                    pane.style.display = 'flex';
                    void pane.offsetWidth; // Force reflow
                    pane.classList.add('active');
                } else {
                    pane.classList.remove('active');
                    pane.style.display = 'none';
                }
            });

            // Trigger specific layout activation
            if (targetLayout === 'focused-triage') {
                renderFocusedTriage();
            } else if (targetLayout === 'command-console') {
                renderCommandConsole();
            }
        });
    });

    // Initialize the default layout pane on load
    renderFocusedTriage();

}


export function renderFocusedTriage() {
    const triageCards = document.querySelectorAll('.triage-card');
    
    function activateIndex(indexKey, card, { preserveTemporal = false } = {}) {
        if (!isIndexProviderReady(indexKey)) {
            enforceCogIndexSupport();
            setCogUiAvailability();
            return;
        }
        state.activeIndex = indexKey;
        state.indexVisible = true;
        
        // Highlight active index button in original suite list
        document.querySelectorAll('.index-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.index === indexKey);
        });
        
        // Highlight the active pill inside the card
        card.querySelectorAll('.triage-tag-pill').forEach(pill => {
            pill.classList.toggle('active', pill.dataset.index === indexKey);
        });
        
        // Render bookmarks for this selected index
        renderSpillBookmarks(indexKey);

        if (preserveTemporal) {
            updateWorkflowSummary(getActiveSpill(), indexKey);
            markActiveWorkflowControls();
            applyIndex();
        } else {
            selectSpill(getActiveSpill());
            markActiveWorkflowControls();

            // The standard evidence pills open the bookmark's event scene.
            if (state.mode !== 'single') {
                setTemporalMode('single');
            } else {
                applyIndex();
            }
        }
        setTimeout(() => probeAcquisitions(), 1600);
    }

    triageCards.forEach(card => {
        // Remove existing listener to prevent duplicate bindings by replacing the node
        const newCard = card.cloneNode(true);
        newCard.querySelectorAll('.triage-bookmarks').forEach(el => el.remove());
        card.parentNode.replaceChild(newCard, card);
        
        // Find default primary index for this card
        const triageType = newCard.dataset.triage;
        let defaultIndex = DEFAULT_INDEX;
        if (triageType === 'oilfield-spill') {
            defaultIndex = DEFAULT_INDEX;
        }

        // Add event listener to the card itself
        newCard.addEventListener('click', (e) => {
            // If the user clicked on a specific pill, we handle it separately in the pill click
            if (e.target.closest('button, summary, details')) {
                return;
            }
            
            // Clear other active cards
            const currentActiveCards = document.querySelectorAll('.triage-card');
            currentActiveCards.forEach(c => {
                c.classList.remove('active');
                c.querySelectorAll('.triage-tag-pill').forEach(p => p.classList.remove('active'));
            });
            newCard.classList.add('active');
            
            activateIndex(defaultIndex, newCard);
        });

        // Add event listeners to individual tag pills inside this card
        const tagPills = newCard.querySelectorAll('.triage-tag-pill');
        tagPills.forEach(pill => {
            pill.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent card level click event from refiring default
                if (pill.disabled || !isIndexProviderReady(pill.dataset.index)) {
                    enforceCogIndexSupport();
                    setCogUiAvailability();
                    return;
                }
                
                // Clear other active cards and make this card active
                const currentActiveCards = document.querySelectorAll('.triage-card');
                currentActiveCards.forEach(c => {
                    c.classList.remove('active');
                    c.querySelectorAll('.triage-tag-pill').forEach(p => p.classList.remove('active'));
                });
                newCard.classList.add('active');
                
                const indexKey = pill.dataset.index;
                activateIndex(indexKey, newCard);
            });
        });

        newCard.querySelectorAll('[data-evidence-stage]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                showEvidenceStage(button.dataset.evidenceStage);
            });
        });

        newCard.querySelectorAll('[data-evidence-compare]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const [leftStage, rightStage] = button.dataset.evidenceCompare.split(':');
                compareEvidenceStages(leftStage, rightStage);
            });
        });

        newCard.querySelectorAll('.evidence-lens-btn').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (button.disabled || !isIndexProviderReady(button.dataset.index)) return;
                newCard.classList.add('active');
                activateIndex(button.dataset.index, newCard, { preserveTemporal: true });
            });
        });

        newCard.querySelector('#timeline-road-check')?.addEventListener('click', event => {
            event.stopPropagation();
            const osmActive = document.querySelector('.layer-toggle.active')?.dataset.layer === 'osm';
            document.querySelector(`.layer-toggle[data-layer="${osmActive ? 'imagery' : 'osm'}"]`)?.click();
        });

        newCard.querySelectorAll('.compare-action').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                document.querySelector('.ui-mode-btn[data-layout="suite-grid"]')?.click();
                document.querySelector('.tab-btn[data-tab="analysis"]')?.click();
                document.getElementById('mode-compare')?.click();
                document.getElementById('btn-swipe')?.click();
            });
        });

        newCard.querySelectorAll('.sar-action').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                if (button.disabled || !isIndexProviderReady('s1_sar')) return;
                activateIndex('s1_sar', newCard);
                document.getElementById('mode-compare')?.click();
                document.getElementById('btn-diff')?.click();
            });
        });

        // ── Inline bookmark list ──────────────────────────────────────────────
        // Collect bookmarks relevant to this triage card
        const cardBookmarks = getDemoSpillBookmarks();

        if (cardBookmarks.length > 0) {
            const bmContainer = document.createElement('div');
            bmContainer.className = 'triage-bookmarks';

            const bmLabel = document.createElement('span');
            bmLabel.className = 'triage-bm-label';
            bmLabel.textContent = 'Screening Sites';
            bmContainer.appendChild(bmLabel);

            cardBookmarks.forEach(spill => {
                const spillId = spill.id || spill.label.replace(/\s+/g, '-').toLowerCase();
                const row = document.createElement('div');
                row.className = 'triage-bm-row';
                row.dataset.spillId = spillId;
                row.classList.toggle('active', spillId === state.activeSpillId);

                const navBtn = document.createElement('button');
                navBtn.type = 'button';
                navBtn.className = 'triage-bm-btn';
                navBtn.dataset.spillId = spillId;
                navBtn.setAttribute('aria-label', `Fly to ${spill.label}, ${spill.displayDate || spill.date}`);
                navBtn.classList.toggle('active', spillId === state.activeSpillId);

                // Header row: name + date
                const header = document.createElement('div');
                header.className = 'triage-bm-header';

                const nameEl = document.createElement('span');
                nameEl.className = 'triage-bm-name';
                nameEl.textContent = spill.label;

                const dateEl = document.createElement('span');
                dateEl.className = 'triage-bm-date';
                dateEl.textContent = spill.displayDate || spill.date;

                header.appendChild(nameEl);
                header.appendChild(dateEl);

                const chips = document.createElement('div');
                chips.className = 'triage-bm-chips';
                getProviderReadyBookmarkIndices(spill).forEach(idxKey => {
                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = `triage-bm-chip triage-bm-chip--${idxKey}`;
                    chip.dataset.spillId = spillId;
                    chip.dataset.index = idxKey;
                    chip.setAttribute('aria-pressed', 'false');
                    chip.setAttribute('aria-label', `Toggle ${INDEX_SHORT_LABELS[idxKey] || idxKey.toUpperCase()} for ${spill.label}`);
                    chip.textContent = INDEX_SHORT_LABELS[idxKey] || idxKey.toUpperCase();
                    chip.addEventListener('click', (e) => {
                        e.stopPropagation();

                        const isSameSite = state.activeSpillId === spillId;
                        const isSameIndex = state.activeIndex === idxKey;
                        if (isSameSite && isSameIndex && state.indexVisible) {
                            hideIndexOverlay();
                            return;
                        }

                        if (!isIndexProviderReady(idxKey)) {
                            enforceCogIndexSupport();
                            setCogUiAvailability();
                            return;
                        }

                        state.activeIndex = idxKey;
                        state.indexVisible = true;
                        document.querySelectorAll('.index-btn').forEach(b => {
                            b.classList.toggle('active', b.dataset.index === idxKey);
                        });

                        document.querySelectorAll('.triage-card').forEach(c => {
                            c.classList.remove('active');
                            c.querySelectorAll('.triage-tag-pill').forEach(p => p.classList.remove('active'));
                        });
                        newCard.classList.add('active');
                        newCard.querySelectorAll('.triage-tag-pill').forEach(p => {
                            p.classList.toggle('active', p.dataset.index === idxKey);
                        });

                        selectSpill(spill, { fly: true });
                        renderSpillBookmarks(idxKey);
                        markActiveWorkflowControls();

                        if (state.mode !== 'single') {
                            setTemporalMode('single');
                        } else {
                            applyIndex();
                        }
                        setTimeout(() => probeAcquisitions(), 1600);
                    });
                    chips.appendChild(chip);
                });

                navBtn.appendChild(header);

                navBtn.addEventListener('click', (e) => {
                    e.stopPropagation();

                    // Activate this button, deactivate siblings
                    bmContainer.querySelectorAll('.triage-bm-btn').forEach(b => b.classList.remove('active'));
                    navBtn.classList.add('active');

                    selectSpill(spill, { fly: true });

                    markActiveWorkflowControls();

                    if (state.indexVisible) setTemporalMode('single');
                    setTimeout(() => probeAcquisitions(), 1600);
                });

                row.appendChild(navBtn);
                row.appendChild(chips);
                bmContainer.appendChild(row);
            });

            newCard.appendChild(bmContainer);
        }
    });

    // Auto-activate the oilfield-spill card so pills are immediately interactive
    // without requiring the user to discover the card-click mechanic first.
    const defaultCard = document.querySelector('.triage-card[data-triage="oilfield-spill"]');
    if (defaultCard && !defaultCard.classList.contains('active')) {
        defaultCard.classList.add('active');
    }
    updateWorkflowSummary();
    markActiveWorkflowControls();
    setCogUiAvailability();
}
window.renderFocusedTriage = renderFocusedTriage;

export function renderCommandConsole() {
    const searchInput = document.getElementById('hud-search-input');
    const clearBtn = document.getElementById('btn-clear-hud-search');
    const tagPills = document.querySelectorAll('.hud-tag-pill');
    const resultsContainer = document.getElementById('hud-index-results');
    const bookmarkResults = document.getElementById('hud-bookmark-results');
    const bookmarkGroup = document.querySelector('.hud-bookmarks-group');
    
    let activeTag = null;
    let searchQuery = '';
    
    // Tag categories map
    const tagMap = {
        water: ['lbi', 'ndwi', 'awei', 'ndmi'],
        vegetation: ['savi', 'ndre', 'ndvi', 'vsi', 'vcbi'],
        soil: ['bsi', 'ndsi', 'swir_rgb', 'bpi', 'cma', 'reai', 'aoi', 'fbc'],
        oilgas: ['pwi', 'pwoi', 'hpwi', 'lbi', 'bpi', 'tri', 'phi', 'cma', 'hmi', 'ehc', 'aoi', 'fbc', 'reai', 'vcbi', 'mvpi']
    };

    function updateHUDResults() {
        resultsContainer.innerHTML = '';
        bookmarkResults.innerHTML = '';
        bookmarkGroup.style.display = 'none';

        // Filter indices
        const matches = Object.keys(INDICES).filter(key => {
            const idx = INDICES[key];
            if (key === 'none') return false;
            // Tag filtering
            if (activeTag && (!tagMap[activeTag] || !tagMap[activeTag].includes(key))) {
                return false;
            }
            
            // Text search filtering
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const nameMatch = idx.name.toLowerCase().includes(q);
                const formulaMatch = idx.formula.toLowerCase().includes(q);
                const infoMatch = idx.info ? idx.info.toLowerCase().includes(q) : false;
                const shortMatch = key.toLowerCase().includes(q);
                if (!nameMatch && !formulaMatch && !infoMatch && !shortMatch) return false;
            }
            
            return true;
        });

        // Render matching index buttons
        matches.forEach(key => {
            const idx = INDICES[key];
            const btn = document.createElement('button');
            btn.className = `index-btn idx-${key}`;
            if (state.activeIndex === key) btn.classList.add('active');
            const providerReady = isIndexProviderReady(key);
            btn.disabled = !providerReady;
            btn.setAttribute('aria-disabled', providerReady ? 'false' : 'true');
            if (!providerReady) btn.title = 'Listed for scientific reference; not available in the current COG renderer.';
            
            btn.innerHTML = `
                ${idx.tags && idx.tags.length ? `<div class="tag-container">${capabilityBadgesHTML(idx.tags)}</div>` : ''}
                <span class="index-short">${key.toUpperCase()}</span>
                <span class="index-full index-full-bold">${idx.name.split(' (')[0]}</span>
            `;
            
            btn.addEventListener('click', () => {
                if (!isIndexProviderReady(key)) {
                    enforceCogIndexSupport();
                    setCogUiAvailability();
                    return;
                }
                state.activeIndex = key;
                document.querySelectorAll('#hud-index-results .index-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Keep original index buttons in sync
                document.querySelectorAll('.index-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.index === key);
                });
                
                applyIndex();
                renderSpillBookmarks(key);
                updateWorkflowSummary(getActiveSpill(), key);
                markActiveWorkflowControls();
                
                // Show matching bookmarks for this selected index in the HUD
                renderHUDBookmarks(key);
            });
            resultsContainer.appendChild(btn);
        });

        if (matches.length === 0) {
            resultsContainer.innerHTML = `<div style="color:var(--text-dim);font-size:11px;padding:12px;">No matching indices found.</div>`;
        }
        
        // Render bookmarks for the active index if it's in the results
        if (state.activeIndex && matches.includes(state.activeIndex)) {
            renderHUDBookmarks(state.activeIndex);
        }
    }

    function renderHUDBookmarks(indexKey) {
        bookmarkResults.innerHTML = '';
        const bookmarks = getDemoSpillBookmarks(indexKey);

        if (bookmarks.length > 0) {
            bookmarkGroup.style.display = 'block';
            bookmarks.forEach(spill => {
                const btn = document.createElement('button');
                btn.className = 'spill-bookmark-btn';
                btn.dataset.spillId = spill.id || spill.label.replace(/\s+/g, '-').toLowerCase();
                btn.classList.toggle('active', btn.dataset.spillId === state.activeSpillId);
                btn.innerHTML = `<span class="spill-name">${spill.label}</span><span class="spill-date-tag">${spill.displayDate}</span>`;
                
                btn.addEventListener('click', () => {
                    selectSpill(spill, { fly: true });
                    
                    document.querySelectorAll('#hud-bookmark-results .spill-bookmark-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    markActiveWorkflowControls();
                    
                    if (state.mode !== 'single') {
                        setTemporalMode('single');
                    } else {
                        applyIndex();
                    }
                    setTimeout(() => probeAcquisitions(), 1600);
                });
                bookmarkResults.appendChild(btn);
            });
        } else {
            bookmarkGroup.style.display = 'none';
        }
    }

    // Set up search listener
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        if (clearBtn) clearBtn.style.display = searchQuery ? 'block' : 'none';
        updateHUDResults();
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchQuery = '';
            clearBtn.style.display = 'none';
            updateHUDResults();
        });
    }

    // Set up tag filters
    tagPills.forEach(pill => {
        // Remove existing listener
        const newPill = pill.cloneNode(true);
        pill.parentNode.replaceChild(newPill, pill);
        
        newPill.addEventListener('click', () => {
            const tag = newPill.dataset.tag;
            if (activeTag === tag) {
                activeTag = null; // Toggle off
                newPill.classList.remove('active');
            } else {
                activeTag = tag;
                document.querySelectorAll('.hud-tag-pill').forEach(p => p.classList.remove('active'));
                newPill.classList.add('active');
            }
            updateHUDResults();
        });
    });

    // Run initial population
    updateHUDResults();
}
window.renderCommandConsole = renderCommandConsole;


// NOTE: downloadHTMLReport, initRrcSpillOverlay, probeAcquisitions → see report.js
