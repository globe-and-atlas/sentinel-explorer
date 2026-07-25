# Limn

Two browser-based Copernicus research tools sharing one codebase:

| App | Entry | Scope | Docs |
|---|---|---|---|
| **Limn Produced Water** | `index.html` | Produced-water spectral screening in the Permian Basin | this file |
| **Limn Atlas** | `atlas.html` | 91 environmental index specifications across 12 domains | [ATLAS.md](ATLAS.md) |

The two are deliberately separate: Atlas contains no produced-water formulas, and Limn's produced-water validation does not extend to Atlas overlays.

---

## Limn Produced Water

A browser-based research and screening tool for studying produced-water-related spectral anomalies at oil and gas sites in the Permian Basin, West Texas and New Mexico.

Built on free Copernicus satellite data (Sentinel-2 optical + Sentinel-1 SAR), it streams processed imagery in real time using custom evalscripts that run directly on Sentinel Hub's servers. No raw data downloads — just the signal.

---

## What it does

- **Visualizes 36 optical and radar lenses** across Sentinel-2 L2A and Sentinel-1 GRD, including established context indices and explicitly experimental produced-water composites
- **Streams live WMS tiles** using Sentinel Hub's processing API, with calibration injection so thresholds tune without rebuilding evalscripts
- **Computes multi-temporal differences** — compare any two dates to see what changed
- **Accumulates signals** with cumulative MAX mode — catches spills that dried up before your query date
- **Scans an area of interest** with the Statistics API — draw a polygon, get an anomaly timeline across 8 indices simultaneously
- **Bookmarks documented spill and context sites** across the Permian Basin, with explicit evidence class, source, date role, and coordinate precision

**Current scientific status (2026-07-21):** PWCI, ASAI, and OBEC are experimental screening architectures, not validated detectors. The development pipeline paired recall of 81.5% / 77.8% / 66.7% with background activation of 96.7% / 71.3% / 71.3%. The shipped precision-first viewer produced 0/150 background activations but was also blank at all 11 reviewed positive sites. A 1,224-combination threshold sweep found no useful produced-water/caliche separation at the tested 500 m single-scene support. LBI's 2/4 standing-brine versus 0/3 freshwater result is preliminary (two-sided Fisher exact p≈0.43). See [the current status note](knowledge/domain/scientific-status-2026-07-20.md) and [investigation summary](reports/investigation_summary_2026-07-20.md).

**Limn Atlas is documented separately.** `atlas.html` organizes 91 proposed environmental index specifications into 24 capability families across twelve domains — 37 render live, 16 are executable but non-live, 38 are specified concepts or retired formulas. It is published as the *Global Spectral Index Atlas* preprint. Atlas overlays are inspectable context, not extensions of Limn's produced-water validation. **See [ATLAS.md](ATLAS.md).**

---

## Run

No build step. Open `index.html` directly in a browser, or serve the folder with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

---

## Setup: Sentinel-2 COGs and Google Earth Engine

Limn Produced Water defaults to **public Sentinel-2 L2A Cloud-Optimized GeoTIFFs** through the local endpoint at `/api/cog/tiles/{z}/{x}/{y}`. This avoids Sentinel Hub credits and avoids GEE's slower interactive tile rendering for the main produced-water demo flow.

The COG path implements the primary investigation stack: **True Color, LBI, MNDWI, AWEIsh, NDMI, SAVI, BSI, dual-SWIR contrast, SWIR false color, and NDRE**, plus the experimental **PWCI, ASAI, and OBEC** comparisons. A collapsed **Gate Diagnostics** drawer also exposes the exact dual-SWIR, SWIR1–NIR, SWIR1–Red, Blue–SWIR2, SWIR1/SWIR2, and SWIR2/Green component responses used by the hypotheses. They are broad-band surface contrasts—not salinity, petroleum, contamination, or heavy-metal measurements. The renderer applies Sentinel-2 Scene Classification (SCL) quality filtering to retain vegetation, bare-soil, water, and unclassified clear pixels while rejecting cloud, cirrus, shadow, snow, saturated/defective, dark-feature, and no-data pixels. COG mode supports before/after swipe comparison; mathematical Diff and Cumulative remain disabled until temporal COG rendering is implemented.

The Screen workspace includes a **Spill Evidence Timeline** for every documented bookmark. Reference (−180 days), Before (−30), Event, After (+30), Late (+180), and Latest buttons drive the actual scene-search date; shortcuts configure Reference↔Event and Event↔Late swipe comparisons. RGB, MNDWI, LBI, PWCI, and ASAI can be changed without losing the selected temporal view. The OSM road check exposes mapped-road confounding and returns to imagery for pad interpretation. Timeline dates are search targets rather than guaranteed acquisition dates: the COG service selects a nearby low-cloud Sentinel-2 scene. Repeated response across stages supports a persistence review but does not identify the source or chemistry.

For PWCI, ASAI, OBEC, and LBI, the COG display distinguishes computation coverage from a threshold response: a muted neutral veil means a clear pixel was screened but did not flag, muted color indicates a non-zero sub-threshold score, and bright index colors indicate threshold-passing candidates. This presentation changes only RGB/alpha display values; it does not relax a gate, alter the scalar score, or convert a candidate into a detection.

Limn Atlas still defaults to **Google Earth Engine true-color context** until Atlas-specific formulas are ported to the COG renderer. Earth Engine service-account credentials stay on the server.

1. Copy the safe browser config:
   ```bash
   cp config.example.js config-v1.js
   ```
2. Keep COG enabled for Produced Water and GEE enabled for Atlas context in `config-v1.js`:
   ```javascript
   window.CONFIG = {
       IMAGE_PROVIDER: "cog",
       COG_TILE_ENDPOINT: "/api/cog/tiles",
       GEE_TILE_ENDPOINT: "/api/gee/tiles",
       ATLAS_GEE_TILE_ENDPOINT: "/api/gee/tiles"
   };
   ```
3. Copy the server env template:
   ```bash
   cp .env.example .env
   ```
4. Fill `.env` with a Google Cloud project and Earth Engine service-account credential path:
   ```bash
   GEE_PROJECT=your-google-cloud-project-id
   GEE_SERVICE_ACCOUNT_JSON_PATH=/absolute/path/to/earth-engine-service-account.json
   ```
5. Start the local tile server:
   ```bash
   npm run start:gee
   ```
6. Open `http://127.0.0.1:4177/index.html` or `http://127.0.0.1:4177/atlas.html`.

The server prewarms a small set of Produced Water demo COG tiles on startup by default. To prewarm manually:
```bash
curl 'http://127.0.0.1:4177/api/cog/prewarm?limit=4&radius=0'
```

Use `COG_PREWARM_ON_START=0` to disable startup prewarm, or increase `COG_PREWARM_RADIUS` when you want adjacent tiles cached around each demo bookmark.

`config-v1.js` and `.env` are gitignored. Never commit service-account JSON, private keys, tokens, or filled runtime config.

Browser API keys alone cannot create Earth Engine maps. Atlas/GEE fallback needs service-account or OAuth credentials authorized for Earth Engine. Produced Water COG browsing uses public STAC/COG assets and does not need GEE credentials.

---

## Fork: what to change

### Imagery provider

COG is the Produced Water default. To temporarily use GEE instead, set `IMAGE_PROVIDER: "gee"`. To temporarily fall back to Sentinel Hub, set both `ALLOW_SENTINEL_FALLBACK: true` and `IMAGE_PROVIDER: "sentinelhub"` in `config-v1.js`, then provide the older CDSE/Sentinel Hub fields. Do this only when you intend to spend Sentinel Hub credits.

Sentinel Hub fallback has an additional credit guard. By default:
```javascript
SENTINEL_CREDIT_GUARD: true,
SENTINEL_LIVE_TILES: false,
SENTINEL_MIN_ZOOM: 14
```

The Produced Water and Atlas top-right map toolbars have a **Sentinel** switch for a temporary live Sentinel Hub session. Off keeps the default COG/GEE renderer. On routes the current session through Sentinel Hub WMS, arms live tiles, and still blocks WMS below the configured minimum zoom. Sentinel WMS loading is deliberately conservative: larger 512px tiles, one request at a time, and Retry-After cooldown handling for HTTP 429 rate limits.

The bundled `AGRICULTURE` WMS carrier is Sentinel-2 L1C, which does not expose the L2A Scene Classification (`SCL`) band. Limn therefore omits the SCL gate only in that optional WMS fallback and displays `WMS: no SCL band`; default L2A COG/GEE rendering retains SCL pixel QA. Set `SENTINEL_WMS_SUPPORTS_SCL: true` only for a verified L2A WMS configuration.

For a shareable Produced Water view that is locked to the guarded Sentinel path, use `share.html` or `index.html?share=sentinel-only`. That mode forces Sentinel Hub as the only analysis renderer, locks the Sentinel switch on, keeps the minimum-zoom guard available, and will not request COG or GEE analysis tiles.

### Default map center and bookmarks

The initial map view and spill bookmarks are defined in `src/app.js`. The default center is the Permian Basin (~31.5°N, 102.5°W). To monitor a different region, change the `MAP_CENTER` and `SPILL_BOOKMARKS` constants. Bookmarks mix exact, facility-level, and regional event/context coordinates; inspect each entry's evidence class, precision, source, and date role before interpretation.

### Calibration presets

Two calibration configs are defined in `src/indices.js` (`CALIBRATION_PRESETS`):
- **`permian`** — tuned for arid desert caliche with high natural SWIR background (default)
- **`standard`** — lower thresholds for temperate/agricultural environments

To adapt for a different geology, duplicate and tune the `permian` preset. The key parameters are:
- `bsiMask` — minimum BSI to pass the bare soil gate (default −0.3, very permissive)
- `pwiSalinityOffset` — NDSI threshold above regional background
- `pwiHydrocarbonOffset` — HCAI threshold above regional iron baseline
- `pwiHmriOffset` — HMRI threshold above regional caliche baseline

All calibration values are injected as JavaScript constants into evalscripts at request time via token replacement (`__BSI_MASK__`, `__PWI_SALINITY_OFFSET__`, etc.).

---

## Index library

**Established contextual methods:** True Color, false color, SWIR false color, NDVI, NDRE, SAVI, MNDWI (Xu green–SWIR form; internal key `ndwi`), AWEIsh, NDMI, MSI, and BSI. The legacy SI/NDSI, CSI, HCAI, HMRI, and NDOI keys are retained as generic surface contrasts; their chemical names are historical labels, not validated retrievals.

**Sentinel Explorer composites and calibrations:**

| Index | Implemented focus | Current status |
|---|---|---|
| PWCI — Produced-Water Contrast Index | BSI-gated three-ratio AND architecture (formerly PWI) | Negative discrimination result; screening proxy only |
| ASAI — Arid Salinity Anomaly Index | Wet/surface and dry/saline Sentinel-2 paths (formerly PWOI / APEX) | Negative discrimination result; screening proxy only |
| OBEC — Optical Brightness/Edge Contrast | Blue/SWIR2 + dual-SWIR + MNDWI-derived surface context (formerly HPWI) | Negative discrimination result; does not retrieve oil/emulsion |
| FBC / REAI | Red/blue or red-edge response × dual-SWIR context | Research-only surface proxies; no iron/brine validation |
| VCBI / VSI | Vegetation-response × dual-SWIR context | Research-only stress proxies; no chloride/source attribution |
| LBI — Liquid/Salinity Response Index | Standing-water bypass + dual-SWIR + wetness + low-vegetation gates | Preliminary 4-brine/3-freshwater result; not enough evidence for brine specificity |
| TRI / BPI / CMA / PHI / HMI | Thresholded surface-ratio composites | Research-only; legacy chemical names do not establish chemistry |
| EHC | RGB surface-context composite | Visualization only; no blowout-morphology classification |
| SCRI | Sentinel-1 VV/VH surface contrast | Not calibrated to electrical conductivity or salt crust |
| MVPI legacy | Single-scene Sentinel-2 SWIR-ratio screen | Not a methane retrieval; no reference-scene fitting |

See [SENTINEL_SCIENCE_GUIDE.md](SENTINEL_SCIENCE_GUIDE.md) for the full scientific reference including formulae, physical basis, band-by-band rationale, and validation methodology.

---

## Data

- **Sentinel-2 L2A (optical):** 13 spectral bands, 10–60m resolution, 5-day revisit, free via CDSE
- **Sentinel-1 GRD (SAR):** VV/VH polarization, C-band (~5.5 cm), 5×20m, cloud-penetrating
- **TRRC (Texas Railroad Commission):** Public source for the produced-water working set (coordinates generalized per RRC data policy; development benchmark, not an audited registry). `data/rrc_spills.json` holds **32** incident records. The 2026-03-28 index run resolved usable statistics for **27** of them; the 1,224-combination threshold sweep uses all **32**. Quote the number that matches the analysis you mean.
- **Archive depth:** Sentinel-2A launched June 2015 — full history available

---

## Key files

```
index.html           # Produced Water entry point (no build step)
atlas.html           # Limn Atlas entry point — see ATLAS.md
config.example.js    # Credential template — copy to config-v1.js and fill in
src/
  app.js             # Map init, WMS layers, spill bookmarks
  indices.js         # All 36 lens definitions, evalscripts, and calibration presets
  map.js             # WMS tile construction and request management
  ui.js              # Control panels and UI logic
  charts.js          # Statistics API scan, anomaly timeline chart
  report.js          # PDF/export generation
  auth.js            # CDSE OAuth token management
execution/           # Python scripts for batch analysis and threshold optimization
tests/               # Node test scripts for evalscript and API validation
SENTINEL_SCIENCE_GUIDE.md   # Scientific reference, formula boundaries, SAR physics, and validation status
ATLAS.md                    # Limn Atlas: registry structure, formula schema, evidence model
```

---

## Tests

```bash
npm run test:core:parity        # Formula parity between renderers
npm run test:core:ui            # UI contract
npm run test:science-status     # Status language does not overclaim
npm run test:spill:timeline     # Spill evidence timeline
npm run test:cog:visibility     # COG screening visibility
npm run test:cog:gates          # Gate diagnostics

node tests/test_produced_water_rendering.mjs
node tests/test_date_selector_filter.mjs
python3 tests/test_cog_boa_offset.py     # Sentinel-2 baseline-04.00 offset handling
```

Atlas has its own suite — see [ATLAS.md](ATLAS.md#tests).

Python tests need the project venv (`.venv/bin/python3`); `rasterio` is not in the system interpreter.
