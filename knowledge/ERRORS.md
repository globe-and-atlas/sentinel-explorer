# 2026-07-21 — Sentinel Hub L1C WMS Rejected the L2A-Only SCL Band

- Error: Guarded Sentinel Hub tiles returned HTTP 400 with `Collection 'S2L1C' has no band 'SCL'` after the primary optical evalscripts added pixel-level Scene Classification masking.
- Cause: Sentinel Hub OGC WMS binds an evalscript to the collection configured for the requested layer. The bundled `AGRICULTURE` carrier layer is Sentinel-2 L1C; `SCL` is a Sentinel-2 L2A band and cannot be requested from that layer.
- Impact: True Color and every generated optical lens failed in the optional Sentinel WMS path even though the default L2A COG and GEE paths were valid.
- Fix: Generated evalscripts now mark their SCL QA block explicitly. `getScriptContent()` removes the `SCL` input and only that marked block for Sentinel WMS unless `SENTINEL_WMS_SUPPORTS_SCL: true` is configured for a verified L2A WMS layer. WMS chart-highlight scripts follow the same contract. The app reports `WMS: no SCL band` while the L1C fallback is active; COG/GEE retain SCL masking.
- Verification: Core parity tests assert both the default L1C-compatible output and the explicit L2A opt-in. Live WMS verification must confirm HTTP 200 for the configured layer without exposing the private instance URL.

## 2026-07-23 follow-up — the fix never reached `execution/limn_hotspot_loop.py`

- Error: Running `execution/limn_hotspot_loop.py` (the official spill-bookmark re-validation script) now fails on every single request with the exact same `HTTP 400: Collection 'S2L1C' has no band 'SCL'` this entry already describes.
- Cause: The 2026-07-21 fix above only touched the real app's render path (`getScriptContent()` in `src/map.js`, which calls `adaptEvalscriptForSentinelWms()`). `limn_hotspot_loop.py`'s own `build_wms_params()` builds its WMS request straight from `index["evalscript"]` — a second, independent code path that duplicates but never received the SCL fix.
- Impact: Nobody has been able to successfully re-run the official spill-bookmark validation since 2026-07-21. Every "OBEC/LBI strong at X" claim currently in `SPILL_BOOKMARKS`' chip text (`src/app.js`) dates from the 2026-06-07/06-08 hotspot-loop runs and had not been re-verified against current evalscripts until manually checked (bypassing the broken script) during a 2026-07-23 QC pass — see `knowledge/DECISIONS.md`.
- Fix: **Applied 2026-07-24.** Added `adaptEvalscriptForSentinelWms` to the embedded Node import in `load_targets()` and wrapped `materialize()`'s return in `adaptEvalscriptForSentinelWms(finalScript, false)` — as the final transform after calibration-placeholder substitution and the VISUAL_FILTER/DETECTION_SENSITIVITY prefix, matching `getScriptContent()`'s ordering exactly. (Note: the fix lives in `materialize()` inside the JS blob, not `build_wms_params()` — the Python side just base64-encodes whatever `materialize()` emitted.)
- Verification: re-ran the loop on matador-desoto-spring-2025 + lake-boehmer-pecos-orphan (flagships) and the new brine calibration site (±45-day sweep, 10 indices) — all requests now return `status: ok` with real strong/moderate/blank verdicts instead of `http-400`. Confirmed via node that every optical evalscript is SCL-free after adaptation (no `'SCL'` token, no `SCL_QA_START` block).

## 2026-07-24 follow-up — new SENTINEL-2-L2A layer 400'd with "Layer not found" despite existing in the Configuration Utility UI

- Error: After creating a real `SENTINEL-2-L2A` layer in the Sentinel Hub Configuration Utility (to fix the L1C/SCL issue above properly), the live app still threw `Sentinel Hub tile error HTTP 400: Layer SENTINEL-2-L2A not found`.
- Cause (two-stage): (1) The layer's first save attempt genuinely hadn't persisted — confirmed by fetching `GetCapabilities` directly against the configured instance and finding no `SENTINEL-2-L2A` entry (likely blocked by an unfilled "Data processing" field). (2) After the user recreated it and it *did* save, the app's own `config-v1.js` (`SH_WMS_URL`) was pinned to a **different, stale Sentinel Hub instance ID** than the one the layer was actually created on — `src/app.js`, `src/charts.js`, `src/report.js`, and `src/atlas-app.js` all already hardcode the correct/current instance internally as their fallback default, but `config-v1.js`'s explicit `window.CONFIG.SH_WMS_URL` override (an older instance ID) took precedence via `getActiveConfig()`'s spread-merge, silently redirecting every WMS request to an instance that never had the layer.
- Impact: A correctly-created Sentinel Hub layer still 400'd because the app was quietly asking a different, older Sentinel Hub instance for it — indistinguishable from the original "layer never saved" failure without a direct `GetCapabilities` probe on the *exact* URL the app is configured to hit.
- Fix: Updated `config-v1.js`'s `SH_WMS_URL` to match the instance ID the layer actually lives on (same instance already hardcoded as the internal default across `app.js`/`charts.js`/`report.js`/`atlas-app.js`), removing the divergence.
- Verification: Direct `GetMap` request against the corrected instance/layer returned `HTTP 200`, `image/png`, ~170KB non-empty tile over the brine calibration bbox.
- Lesson: When diagnosing a Sentinel Hub "layer not found" error, always probe `GetCapabilities` against the **exact URL the running config resolves to** (`getActiveConfig().SH_WMS_URL`), not just "the instance I was just editing in the browser" — a config override pointing at a different instance ID produces an identical symptom to a genuinely unsaved layer.

---

# 2026-07-19 — batch_analyze_spills.py NameError: Path not defined (validation pipeline broken)

- Error: `execution/batch_analyze_spills.py` raised `NameError: name 'Path' is not defined` at import (line 12, `env_path = Path(__file__)...`). The script could not run or be imported.
- Cause: The module used `pathlib.Path` for `.env` loading but never imported it (`from pathlib import Path` was missing). A prior refactor removed the import while leaving the usage.
- Impact: The offline validation pipeline that produces the published recall numbers (PWCI 81.5% etc.) was non-runnable in its current form; also blocked reuse of `calculate_indices` by the new false-positive sampler.
- Fix: Added `from pathlib import Path` to the imports. Verified with `python3 -c "import batch_analyze_spills"` (imports cleanly).
- Graduated-to: Deterministic import error — noted here; no domain doc needed. Reinforces the workspace pathlib convention (CLAUDE.md).

---

# 2026-06-25 — Atlas Capture Mode Swipe/Mirror Basemap Clipping and Test Suite Failures

- Error: The capture split/mirror comparison pane clipped the underlying basemap context (rendering half of the split blank/black) and GEE mode did not restrict comparison controls. Puppeteer tests failed at `hasModeButtons` count, `overlayClipPath` timeouts, and invalidation checks.
- Cause:
  1. `wmsLayer` (FetchTile/FetchWMS) shared Leaflet's standard `tilePane` with the basemaps, so masking the layer pane clipped both.
  2. `hasCaptureInterpretationLayer()` did not verify `isSentinelProvider()`, causing GEE fallback context to enable Split/Overlay comparison sliders and fail the context-only test assertion.
  3. The test suite expected exactly 3 buttons but 4 buttons (including Mirror) were present in the HTML; it also expected `overlayClipPath` to be exposed in `getAtlasCaptureState()`.
  4. `map.invalidateSize()` was still present in `src/atlas-app.js`, failing the test's `doesNotMatch` verification.
- Impact: Users saw visual clipping on Swipe/Mirror comparison overlays, and integration test checks failed to execute cleanly.
- Fix:
  1. Created a custom Leaflet pane `atlasWmsPane` at z-index `350` and moved overlay layers into it.
  2. Updated `hasCaptureInterpretationLayer()` and `captureUnavailableMessage()` to check `isSentinelProvider()` and provide correct prompts.
  3. Restored `capture-mode-label` in `atlas.html`, exposed `overlayClipPath` in `getAtlasCaptureState()`, and updated button count expectations to 4 in tests.
  4. Removed the `map.invalidateSize()` call from `setCaptureMode()`.
- Verification: Tested using `node tests/test_atlas_sentinel_toggle.mjs` and `node tests/test_gee_provider.mjs` (both pass cleanly).
- Graduated-to: no; local Leaflet pane and test config.

# 2026-06-23 — Atlas LinkedIn Panel Smoke Used Brittle Body Text Check

- Error: `node tests/test_atlas_sentinel_toggle.mjs` failed with `hasPanel:false` while the visual-anchor, observation, why, question, copy button, and draft word-count checks all passed.
- Cause: The smoke test checked `document.body.innerText.includes('LinkedIn Ground Truth')`, but headless layout did not expose that label text as expected even though the panel contract elements were present.
- Impact: The browser smoke failed on a broad text assertion instead of the actual stable UI contract.
- Fix: Switch the browser smoke to assert the stable `#info-linkedin-ground-truth` element and generated ingredient IDs instead of broad body text.
- Graduated-to: no; local test-selector brittleness.

# 2026-06-16 — Atlas PETI Citation Opened Unrelated Protein-Folding Paper

- Error: The PETI water-quality source link claimed to be a Lake Taihu bloom review, but the URL resolved to a PMC article titled `Dynamical Phase Transitions Reveal Amyloid-like States on Protein Folding Landscapes`.
- Cause: The Atlas source metadata used a stale/wrong `sourceUrl` for a Lake Erie cyanobacteria bookmark.
- Impact: Following the PETI citation sent users away from the water-quality evidence trail and undermined the Atlas index demonstration.
- Fix: Replaced PETI with the NOAA NCCOS Lake Erie 2019 HAB retrospective, replaced CSRC's mismatched Lake Erie source with NASA Earthdata Lake Taihu monitoring, and cache-busted Atlas data imports so the browser refreshes corrected citation metadata.
- Verification: Browser checks confirmed PETI shows the NOAA link and no protein/PMC citation; CSRC shows NASA Earthdata Lake Taihu and no stale Lake Erie source. Syntax checks, provider tests, Atlas toggle smoke, and `git diff --check` passed.
- Graduated-to: `knowledge/domain/api-contracts.md`.

# 2026-06-16 — Atlas Evidence Audit Found Broken Primary Bookmark Sources

- Error: Strict three-source evidence auditing found 10 renderable Atlas bookmarks whose primary citation was unreachable due to 404, DNS failure, timeout, or site blocking.
- Cause: Several bookmarks used generic homepages, stale agency URLs, or WAF-blocked publisher pages as their primary citation.
- Impact: The visible evidence pack could otherwise appear trustworthy because sensor/service links were reachable while the bookmark-specific citation was broken.
- Fix: Replaced the broken primary sources with reachable, topic-matched citations for RRFI, CBSDI, CD-UAI, WDA-CSI, EC-ACI, LRD-VSI, PCEI, PDCSI, LISI, and TFIDI. Added `execution/audit_atlas_evidence.py` so future regressions are deterministic.
- Verification: Final audit reports 44 renderable bookmarks, 44 Gold-ready evidence packs, and 0 cleanup items.
- Graduated-to: `knowledge/procedural/atlas_evidence_standard.md`.

# 2026-06-16 — Strong Verification Could Be Masked By Generic Evidence Links

- Error: The first evidence audit could mark rows as Gold-ready because generic sensor/service links were reachable, even when the curated bookmark verification layer had dead secondary links.
- Cause: The audit only required three reachable evidence URLs and primary-source reachability.
- Impact: A row could appear Strong while one of its Strong-specific event/method/local sources was broken.
- Fix: `execution/audit_atlas_evidence.py` now fails Strong rows if any curated verification evidence URL is unreachable. Dead secondary links in `src/atlas-verification.js` were removed or replaced.
- Verification: The stricter audit reports 44 Gold-ready evidence packs, 0 cleanup items, and the upgraded Medium/Medium-Strong rows show as Strong verified.
- Graduated-to: `knowledge/procedural/atlas_evidence_standard.md`.

# 2026-06-16 — Atlas Viewer Source Used Non-WMS Copernicus Viewer ID

- Error: The Atlas Viewer source attempted to construct an OGC WMS endpoint from `sh-d7374040-889f-4013-aac2-046a15f6d8ba`.
- Cause: A Copernicus Browser/Viewer id was treated as if it were a Sentinel Hub OGC WMS configuration instance id.
- Impact: Live Atlas WMS QC through that account could not run; direct probes returned HTTP 404/400 before any bookmark scoring could happen.
- Fix: Atlas no longer constructs a WMS endpoint from the invalid `sh-d...` id. After the service endpoint id was clarified, the Viewer source now falls back to the verified OGC WMS configuration id `83a6b821-c0ad-43b1-848f-06f7b6b528a7`. The QC script also accepts `--wms-url` for explicit endpoint testing.
- Verification: Direct `GetCapabilities` for `83a6b821-c0ad-43b1-848f-06f7b6b528a7` returned `200 application/xml`; the stubbed Atlas source-toggle smoke test verifies configured/viewer switching.
- Graduated-to: `knowledge/domain/api-contracts.md`.

# 2026-06-09 — GEE Tile Burst Returned HTTP 429 and Blank Map

- Error: The launcher-backed GEE app rendered a blank overlay while the console showed repeated `/api/gee/tiles/...` HTTP 429 responses for HPWI/OBEC tiles.
- Cause: The local GEE proxy was forwarding Leaflet's burst of tile requests directly to Earth Engine. A single curl tile could succeed, but the browser grid could exceed GEE request-rate limits before map tiles loaded. The Produced Water GEE layer also used raw `<img>` tile loading, so transient 429 responses became immediate tile errors instead of queued retries.
- Fix: Added server-side outbound tile queueing, 429 retry/backoff, in-flight dedupe, and successful tile byte caching. Replaced the Produced Water GEE layer with a fetch-based rate-limited tile loader, added the same queue behavior to Atlas GEE tiles, and bumped browser module cache keys to `v=77`.
- Verification: `node --check src/app.js src/map.js src/report.js src/atlas-app.js server/gee_tile_server.mjs`; `node tests/test_gee_provider.mjs`; `node tests/test.js`; `node tests/test_atlas_gee_smoke.mjs`; live `curl -I` to the launcher-backed `4180` HPWI tile returned HTTP 200; live headless browser check against `http://127.0.0.1:4180` saw 30 GEE tile responses, all HTTP 200, with no page errors.
- Graduated-to: `knowledge/domain/api-contracts.md`.

# 2026-06-09 — Sentinel Hub Toast Appeared During GEE Browsing

- Error: The app showed `Sentinel Hub tile request failed for hpwi` during normal map browsing even though GEE should be the active provider.
- Cause: `config-v1.js` can override internal defaults, and the app previously honored `IMAGE_PROVIDER: "sentinelhub"` without requiring the separate fallback opt-in flag. Because `config-v1.js` is secret-bearing, it was not inspected; the behavior was fixed by enforcing the runtime contract instead.
- Fix: `getActiveConfig()` now forces `IMAGE_PROVIDER` and `IMAGERY_PROVIDER` to the internal default unless `ALLOW_SENTINEL_FALLBACK === true`. `getImageryProvider()` applies the same guard before selecting the layer factory.
- Verification: Live browser check against `http://127.0.0.1:4180` resolved provider away from Sentinel Hub, made 0 Sentinel Hub/WMS requests, and showed no Sentinel Hub tile-error toast. `node --check src/app.js && node --check src/map.js`, `node tests/test_gee_provider.mjs`, `node tests/test.js`, `node tests/test_atlas_gee_smoke.mjs`, and `node tests/test_produced_water_rendering.mjs` passed.
- Graduated-to: `knowledge/domain/api-contracts.md`.

# 2026-06-09 — Fresh Verifier Looked For Browser Variable Names In GEE Expressions

- Error: A fresh verifier failed while checking that `server/gee_tile_server.mjs` contained the literal `ndsi - 0.02` LBI gate.
- Cause: The GEE server uses inline Earth Engine expression math rather than browser-side `ndsi` variable names, so the verifier's assertion was too implementation-specific.
- Fix: Reran the verifier against the actual threshold fragments (`- 0.02`, `+ 0.40`, `0.45 -`, `+ 0.20`, and `-0.25`) plus the no-forced-resampling and retina-tile contracts.
- Verification: Corrected fresh verifier passed.
- Graduated-to: none; verifier-session specificity only.

# 2026-06-09 — GEE Render Looked Coarse and LBI Was Overbroad

- Error: GEE analytical overlays looked visibly coarser than the prior Sentinel Hub path, and LBI painted too much wet-ish Permian background.
- Cause: The GEE path was requesting normal display tiles even on high-DPI desktop displays, while LBI still used the older permissive liquid-brine expression in several paths. The permissive formula accepted broad background where NDWI was merely less dry than surrounding arid soil. AOI statistics also omitted `B02` from `fisBands` even though the LBI BSI gate used `B02`.
- Fix: Enabled high-DPI/retina GEE tile requests for Produced Water and Atlas. Tightened LBI to require `BSI > -0.25`, `NDSI > 0.02`, `NDWI > -0.40`, `NDVI < 0.45`, and `BSI > -0.20`, then aligned that logic across the GEE server, browser evalscript, Sentinel Hub fallback, compare/diff path, AOI statistics, and chart anomaly threshold. Added a regression assertion that LBI statistics bands include `B02`.
- Verification: Lake Boehmer z14/x3516/y6694 LBI alpha coverage dropped from 78.133% to 1.466%, while OBEC stayed 6.284% and ASAI stayed 2.283%. Live high-DPI browser check displayed zoom 14 while requesting GEE zoom 15 tiles, with 32/32 HTTP 200 tile responses. `node --check` passed for changed JS; `node tests/test_produced_water_rendering.mjs`, `node tests/test_gee_provider.mjs`, `node tests/test.js`, and `node tests/test_atlas_gee_smoke.mjs` passed.
- Graduated-to: `knowledge/domain/api-contracts.md`, `knowledge/domain/spectral-indices.md`.

# 2026-06-09 — zsh Globbed Versioned Asset URL During Header Check

- Error: `curl -I http://127.0.0.1:4180/src/app.js?v=77` failed with `zsh: no matches found`.
- Cause: In zsh, unquoted `?` is treated as a filename glob pattern before `curl` receives the URL.
- Fix: Quote versioned URLs in shell checks, e.g. `curl -I 'http://127.0.0.1:4180/src/app.js?v=77'`.
- Graduated-to: none.

# 2026-06-09 — Stale Browser Modules and Noisy Leaflet Plugin Warning

- Error: User still saw `(index):1 Uncaught (in promise) Object name: "FetchError"` plus the Leaflet side-by-side `L.Mixin.Events` deprecation after the GEE tile hardening.
- Cause: The local server served HTML/JS/CSS without explicit cache headers, so Chrome could keep stale module imports such as `map.js?v=76`. The side-by-side plugin also emits a known Leaflet 1.9 deprecation warning on load even when compare mode still works.
- Fix: Serve HTML/JS/CSS with `Cache-Control: no-store`, bump the remaining module tags/imports to `v=77`, add a narrow unhandled-rejection guard for opaque `FetchError` objects, and suppress only the exact side-by-side `L.Mixin.Events` warning while the plugin loads.
- Verification: `curl -I` confirms `index.html`, `src/app.js?v=77`, and `src/map.js?v=77` return `Cache-Control: no-store`; live headless browser console check against `http://127.0.0.1:4180` saw 12 GEE tile responses, all HTTP 200, with no page errors and no console entries for the Leaflet deprecation or `FetchError`.
- Graduated-to: none.

# 2026-06-09 — GEE Tiles Loaded But Analytical Overlays Were Transparent

- Error: Base imagery loaded and GEE tile requests returned HTTP 200, but the analyzed raster overlays did not appear on the map.
- Cause: Produced Water GEE requests used exact single-day Sentinel-2 windows such as `time=2026-01-01`. Earth Engine returned empty transparent mosaics when no valid Sentinel-2 scene matched that exact day. The app also initialized the map at the legacy `dixon` AOI before selecting the active Lake Boehmer bookmark, so the first overlay could be drawn over the wrong area.
- Fix: Expanded single-date GEE requests to a default 30-day lookback and 15-day forward window, raised the GEE Sentinel-2 default cloud tolerance to `maxcc=90`, and initialized the Leaflet map at the active spill bookmark coordinates.
- Verification: Direct alpha checks on Lake Boehmer z14/x3516/y6694 show true color 99.403% non-transparent, OBEC 6.284%, LBI 78.133%, and ASAI 2.283%. Live startup browser check centers at `31.226, -102.729`, zoom `14`, with 9 loaded GEE overlay blob tiles and HTTP 200 responses.
- Graduated-to: `knowledge/domain/api-contracts.md`.

# 2026-06-09 — Syntax Check Run From Wrong Project Directory

- Error: After restarting Limn through App Studio, `node --check server/gee_tile_server.mjs` failed with `Cannot find module '/Users/danielbally/Git/app-studio/server/gee_tile_server.mjs'`.
- Cause: The validation command was chained from the `app-studio` working directory instead of the `limn` working directory.
- Fix: Rerun Limn validation commands from `/Users/danielbally/Git/limn`.
- Graduated-to: none.

# 2026-06-08 — Spill Bookmark Chip Overclaims After ASAI Tightening

- Error: Several bookmark chips implied current proof/support from lenses that were blank, weak, or intentionally negative-control under the latest evalscripts.
- Cause: ASAI thresholds were tightened after prior hotspot-loop promotion artifacts, but the bookmark chip metadata was not fully re-audited against a fresh baseline. The sidebar also used the label "Verified Sites" for a mixed list of proof, context, and negative-control bookmarks.
- Fix: Reran a current baseline hotspot loop, removed non-promotable Apache BPI and EnLink control chips, removed stale ASAI chips from Black River and OXY Lea, switched OXY Lea to LBI support, and renamed the sidebar group to "Screening Sites."
- Verification: `python3 execution/audit_spill_index_claims.py --summary .tmp/limn_hotspot_loop/20260608-143636_summary.json --fail-on-fail` passed with zero failures.
- Graduated-to: `knowledge/procedural/limn_hotspot_loop.md`.

# 2026-06-08 — Meister Ranch ASAI Bookmark Chip Overclaim

- Error: Meister Ranch Geyser showed an `ASAI` verified-site chip even though the app currently shows visible signal for `LBI`, not `ASAI`, at that bookmark.
- Cause: `SPILL_BOOKMARKS` still listed `pwoi` for Meister after the hotspot-loop result had established Meister as an LBI proof target. The bookmark note also left an outdated "re-check" sentence for ASAI.
- Fix: Removed `pwoi` from the Meister bookmark `indices` array and updated the note to state that PWCI/ASAI are blank at the measured proof frames.
- Verification: Saved shortlist `.tmp/limn_hotspot_loop/meister2022_lbi_shortlist.md` reports LBI `strong`; `.tmp/limn_hotspot_loop/meister2022_pwoi_shortlist.md` reports ASAI `blank`. `node --check src/app.js`, `python3 execution/qc_limn_spill_bookmarks.py --fail-on-fail`, `node tests/test.js`, and a direct `SPILL_BOOKMARKS` assertion passed.
- Graduated-to: `knowledge/procedural/limn_hotspot_loop.md`.

# 2026-06-08 — Puppeteer screenshot harness timeout helper mismatch

- Error: Temporary `.tmp/ui_review_screenshot.cjs` failed with `TypeError: page.waitForTimeout is not a function`.
- Cause: The installed Puppeteer/Core runtime used by the project smoke harness does not expose `page.waitForTimeout`.
- Fix: Use a local `sleep(ms)` promise helper in temporary browser-review scripts.
- Graduated-to: procedural browser review practice; no production code impact.

# 2026-06-08 — Puppeteer screenshot harness mixed Node/page context

- Error: Temporary `.tmp/ui_review_screenshot.cjs` failed with `ReferenceError: logs is not defined` inside `page.evaluate`.
- Cause: A Node-side console log array was referenced from browser page context.
- Fix: Return DOM metrics from `page.evaluate`, then attach captured console logs from Node after evaluation.
- Graduated-to: procedural browser review practice; no production code impact.

# Error Log

## 2026-06-08: Browser Smoke Navigation Timeout — TRANSIENT

- **Infrastructure error**: First `node tests/test.js` run timed out at `page.goto()` with `Navigation timeout of 30000 ms exceeded`.
- **Impact**: Initial browser smoke verification did not complete.
- **Follow-up**: Immediate retry passed with the expected trial-mode auth warning only.
- **Graduated to**: none; one-off local browser/server timing issue unless it recurs.

## 2026-06-08: ImageMagick Missing During Hotspot Thumbnail QA

- **Infrastructure error**: `magick montage` failed with `zsh:1: command not found: magick` while building a contact sheet for produced-water hotspot thumbnails.
- **Impact**: The visual QA contact sheet could not be generated through ImageMagick.
- **Workaround**: Generated `.tmp/limn_hotspot_loop/20260607-230231_contactsheet.png` using the local Python/Pillow imaging stack.
- **Graduated to**: none; this is an optional local tooling gap, not an app/runtime dependency.

## 2026-06-07: Produced-Water Fresh Verifier QC Shape Assumption — RESOLVED

- **Deterministic error**: The fresh local verifier failed with `TypeError: string indices must be integers, not 'str'`.
- **Cause**: The verifier assumed `.tmp/limn_spill_bookmark_qc.json` was a top-level list, but the QC artifact stores bookmark rows under a `results` key.
- **Fix**: Rerun the verifier using `qc["results"]` when present.
- **Graduated to**: Not graduated; one-off verifier harness issue.

## 2026-06-07: Produced-Water Bookmark Index Overclaims — RESOLVED/PARTIAL

- **Deterministic error**: Several original Limn spill bookmarks presented PWCI, ASAI, or OBEC as proof defaults even though the measured public-WMS loop showed those specific index/bookmark pairs were blank, weak, or too broad to prove the advertised concern.
- **Cause**: Bookmark chips were assigned from expected spill chemistry rather than measured live WMS behavior at documented dates/coordinates. Strict PWCI is an AND gate and intentionally blanks many open-water or dry/residue cases; LBI is the better proof path for the documented brine geyser/crevice scenes. Some fallback indices, especially VSI/HCAI-style broad overlays, can also look numerically strong while filling nearly the whole tile.
- **Impact**: Default bookmark clicks could fail to show a noticeable signal, or could imply that PWCI detected produced water at sites where the strict composite did not fire.
- **Fix**: Added `execution/limn_hotspot_loop.py` to score documented bookmark/index candidates through public WMS with source/date/spatial bounds, thumbnails, shortlists, retry handling, and uniform-frame rejection. Updated `SPILL_BOOKMARKS` so Lake Boehmer uses OBEC/ASAI, Meister and Crane use LBI, Toyah uses OBEC, Apache is context-only, Antina/EOG/OXY are explicitly context-only measured scenes, and EnLink is a PWCI/ASAI negative control.
- **Verification**: Final edited-bookmark baseline loop `.tmp/limn_hotspot_loop/20260607-221436_summary.json` checked 13 current bookmark-index targets; Lake Boehmer OBEC/ASAI, Meister LBI, Crane LBI, Antina OBEC/LBI, and EOG ASAI were strong; Toyah OBEC and OXY OBEC/ASAI were moderate; Apache BPI and EnLink PWCI/ASAI were non-promotable. `python3 execution/qc_limn_spill_bookmarks.py --fail-on-fail`, `node --check src/app.js && node --check src/indices.js && node --check src/map.js`, `python3 -m py_compile execution/limn_hotspot_loop.py execution/qc_limn_spill_bookmarks.py`, `node tests/test_pwi.js`, `node tests/test_evalscript.js`, and `node tests/test.js` passed.
- **Remaining risk**: LBI proof scenes for Meister/Crane are broad brine/liquid-field detections rather than pixel-perfect spill outlines; Apache remains a documented produced-water spill but not a proof-grade live spectral target in this app.
- **Graduated to**: `knowledge/procedural/limn_hotspot_loop.md`.

## 2026-06-07: Atlas Uniform Overlay False Proof — RESOLVED/PARTIAL

- **Deterministic error**: SACI, FGDCI, S1-VVS, and S5P/SAR demos could score as visually strong because low-value background pixels were painted with nonzero alpha or because a single-scene proxy filled nearly the whole tile.
- **Cause**: Several evalscripts had no transparency gate for low-confidence background. FGDCI also tried to use an instantaneous VV−VH proxy for a formula whose defensible claim requires a seasonal anomaly.
- **Impact**: Bookmark QC could mistake broad full-frame tint for a proof-grade hotspot.
- **Fix**: Added transparent background gates to SACI, S1-OWF, S1-URB, S1-VVS, S5P-NO2, and S5P-SO2. Added a uniform-frame guard and spatial-budget reserve to `execution/hotspot_loop.py`. Promoted clear measured hotspots for BH-DFSI and the demonstrators. Demoted FGDCI from live proof target to proof-target pending.
- **Remaining risk**: FGDCI still needs a true temporal seasonal-mean anomaly implementation or a non-uniform documented freeze/thaw target before it should be restored as a live proof layer.
- **Verification**: `python3 execution/hotspot_loop.py ...`, `python3 execution/qc_atlas_bookmarks.py --size 512 --sweep-days 0 --sweep-targets none`, `node tests/test.js`, `node tests/test_atlas_lfmpi.mjs`, and `node tests/test_atlas_smpdi.mjs` passed.
- **Graduated to**: `knowledge/procedural/atlas_hotspot_loop.md`.

## 2026-06-07: Fresh Verifier Safety Check False Positive — RESOLVED

- **Deterministic error**: The fresh-process verifier failed because it searched for the literal string `config-v1.js` in `execution/hotspot_loop.py`.
- **Cause**: The loop script contains a safety docstring saying it does not read `config-v1.js`; the verifier treated that documentation text as a forbidden secret read.
- **Fix**: Rerun the verifier with a narrower check for read/open/import/access patterns rather than banning explanatory safety text.
- **Graduated to**: Not graduated; verifier-session specificity only.

## 2026-06-07: SMPDI Land False Positives — RESOLVED

- **Deterministic error**: SMPDI rendered substantial signal on Caribbean land/coastal vegetation even though the index is intended for floating Sargassum/microplastic discrimination.
- **Cause**: The evalscript computed the floating-material contrast (`FAI - SWIR vegetation contrast`) without first requiring water context or rejecting SWIR-bright terrestrial surfaces.
- **Fix**: Added `waterContext` and `landReject` gates to SMPDI, made zero/land-like output transparent, and moved the default bookmark to a measured water-gated proof target: July 2, 2022 at zoom 12.
- **Verification**: `node tests/test_atlas_smpdi.mjs` confirms vegetated island and bright coast samples are transparent while a floating water-context mat renders; `python3 execution/qc_atlas_bookmarks.py --size 512 --sweep-days 0 --sweep-targets none` reports SMPDI as `strong` with 3.602% visible and 2.396% high-signal coverage.
- **Graduated to**: `knowledge/procedural/atlas_viewer_validation.md`.

## 2026-06-07: Limn Spill Bookmark Source/Date Drift — RESOLVED

- **Deterministic errors**: Several `SPILL_BOOKMARKS` entries lacked structured source URLs and event-date metadata; Meister used `2022-01-01`, just outside the documented January 2022 blowout/subsidence window; Antina Ranch used stale 2020 metadata despite source reporting a June 2021 brine-water leak; EOG Klondike was labeled Eddy County even though the cited Q2 2025 report identifies the large Klondike produced-water spill in Lea County; EnLink Chickadee was grouped with produced-water bookmarks despite being a crude-oil spill.
- **Cause**: The bookmark list mixed event dates, display dates, representative imagery dates, and calibration-control cases in free-text fields without machine-checkable metadata.
- **Fix**: Added `sourceUrl`/`sourceUrls`, `evidenceClass`, `eventDate`, and `dateRole` to all nine bookmarks; corrected Meister to `2022-01-14`; corrected Antina Ranch to `2021-06-17`; corrected EOG Klondike to Lea County and `2025-06-10`; marked EnLink Chickadee as `hydrocarbon-negative-control`; reclassified regional Antina/EOG/OXY bookmarks as `produced-water-context`.
- **Verification**: `python3 execution/qc_limn_spill_bookmarks.py --fail-on-fail` checked 9 bookmarks with 9 `pass`, 0 `warn`, and 0 `fail`; `node --check src/app.js && node --check src/indices.js && node --check src/map.js`; `node tests/test_pwi.js && node tests/test_evalscript.js`.
- **Remaining debt**: Antina Ranch, EOG Klondike, and OXY Mesa Verde are intentionally retained as context bookmarks rather than proof-grade GPS targets.
- **Graduated to**: `knowledge/procedural/limn_spill_bookmark_qc.md`.

## 2026-06-08: PWCI/OBEC Opacity and ASAI Background Noise — RESOLVED

- **Deterministic error**: User observed PWCI and OBEC appearing transparent or disappearing at high values, while ASAI appeared too noisy after becoming the default produced-water lens.
- **Cause**: Produced-water evalscripts relied on palette interpolation without explicit low-signal alpha gates, and ASAI's wet path produced nonzero scores across ordinary arid background pixels. The shared palette helper also did not clamp non-finite/out-of-range values before interpolation.
- **Fix**: Clamped `colorBlend()` input to `[0,1]`, added explicit transparent output gates for low PWCI/OBEC mapped values, tightened ASAI wet-path salinity/smoothness gates, tightened ASAI dry-brine thresholds, and added focused synthetic evalscript regression coverage.
- **Verification**: `node --check src/indices.js`; `node --check tests/test_produced_water_rendering.mjs`; `node tests/test_produced_water_rendering.mjs`; `node tests/test_pwi.js`; `node tests/test_evalscript.js`; `node tests/test.js`.
- **Graduated to**: `knowledge/domain/spectral-indices.md`.

## 2026-06-08: Fresh Verifier Coverage Assertion Was Over-Specified — RESOLVED

- **Deterministic error**: A one-off fresh-process verifier failed while checking that `tests/test_produced_water_rendering.mjs` contained transformed fragments of each contract sentence.
- **Cause**: The verifier mutated the contract strings before searching the test file, so the assertion looked for phrases that were not present even though the behavioral evalscript assertions passed in the focused test.
- **Fix**: Removed the brittle sentence-fragment check and kept the verifier focused on concrete source gates plus direct synthetic evalscript behavior.
- **Verification**: Corrected fresh-process verifier passed.
- **Graduated to**: none; one-off verifier harness issue.

## 2026-06-08: ASAI Broad Salty Bare-Soil Wash — RESOLVED

- **Deterministic error**: ASAI rendered broad arid fields as a magenta/cyan wash, making the index visually unusable as a screening lens.
- **Cause**: The dry-brine path accepted moderately salty bare soil (`NDSI > 0.07`, `BSI > 0.14`) and rendered values above `0.45`, so common Permian background cleared the gate.
- **Fix**: Tightened ASAI dry-brine gates to `smoothness proxy < -0.42`, `NDSI > 0.15`, and `BSI > 0.52`, raised the render floor to `0.60`, and added a broad salty bare-soil regression sample.
- **Verification**: `node --check src/indices.js`; `node --check tests/test_produced_water_rendering.mjs`; `node tests/test_produced_water_rendering.mjs`; `node tests/test.js`; ASAI screenshot `.tmp/limn-ui-asai-after-tighten.png` shows sparse candidates instead of full-frame wash.
- **Graduated to**: `knowledge/domain/spectral-indices.md`.

## 2026-06-07: Atlas Bookmarks Not All Proof-Grade — RESOLVED

- **Deterministic error**: Several Atlas bookmarks did not show noticeable high-signal overlays under the live public WMS path, so they could not prove that the advertised index/composite detected its target condition.
- **Cause**: Some bookmarks were event/context scenes rather than measured peak-signal scenes, and the previous review logic did not quantify visible coverage, high-signal coverage, or intensity. Tiny bright specks could be mistaken for a successful proof target without spatial coverage checks.
- **Fix**: Added `execution/qc_atlas_bookmarks.py` and `execution/qc_atlas_candidate_bookmarks.py`; tightened verdict thresholds so spatially tiny hotspots do not count as `strong`; promoted measured strong defaults for BH-DFSI, RRFI, EPDI, SMPDI, KCDSI, TT-API, and PDCSI; demoted non-proof Atlas entries to context/non-renderable instead of leaving weak overlays as proof claims.
- **Verification**: Final current-bookmark QC produced 38 renderable `strong`, 53 `non-renderable`, and 0 `moderate`/`weak`/`blank`/`error` verdicts among renderables; artifacts written to `.tmp/atlas_bookmark_qc.json`, `.tmp/atlas_bookmark_qc.md`, `.tmp/atlas_candidate_bookmark_qc.json`, and `.tmp/atlas_candidate_bookmark_qc.md`; `node --check src/atlas-app.js && node --check src/atlas-indices.js`; `node tests/test_atlas_lfmpi.mjs`.
- **Remaining debt**: SWRI, DWCI, GMCPI, MDSPI, SPEI, SCSPI, TRSI, CCRBI, IERPI, SPSRI, FEDGI, SLSDI, UBCDI, AIBEAI, and PWTDI are context/non-renderable backlog items requiring stronger measured proof targets or their required sensor/model paths.
- **Graduated to**: `knowledge/procedural/atlas_viewer_validation.md`.

## 2026-06-07: Limn Atlas WMS and Bookmark Review Issues — RESOLVED

- **Deterministic errors**: Limn Atlas loaded `config-v1.js` but ignored WMS config values; WMS tile failures did not surface in the UI; OWSI was marked renderable with a `2010-05-15` Sentinel-style bookmark; IERPI presented as live Landsat rendering while using the Sentinel WMS path; hyphenated acronym search did not match punctuation-free queries such as `bhdfsi`; the base-layer toggle label could become inverted after switching base maps.
- **Cause**: The Atlas page was implemented as a simplified standalone viewer with a hardcoded WMS endpoint/layer, no tile lifecycle status UI, and catalog metadata copied from real-world event context without enforcing sensor availability constraints.
- **Fix**: Added optional Atlas WMS config fields with fallbacks, wired index-specific WMS layer support, added `tileerror` status feedback, moved OWSI to a post-Sentinel-2 context date, relabeled IERPI as an S2 approximation, normalized search by stripping punctuation and accents, and restored the base-layer label to reflect the active base map.
- **Verification**: `node --check src/atlas-app.js && node --check src/atlas-indices.js`; atlas data shape audit; 91 evalscript synthetic execution audit; browser smoke test on `http://localhost:4193/atlas.html`; fresh Node verifier process.
- **Graduated to**: `knowledge/procedural/atlas_viewer_validation.md`.

## 2026-06-07: LFMPI Water False Positive — RESOLVED

- **Deterministic error**: LFMPI rendered open water as a pre-ignition live-fuel risk because low moisture-proxy values mapped to opaque red without checking whether the pixel was actually vegetated fuel.
- **Cause**: The evalscript inverted/colored the live-fuel moisture proxy before applying any water rejection or live-vegetation gate.
- **Fix**: Added `mndwi` water rejection, an explicit `liveFuel` vegetation gate, transparent output for non-risk/non-fuel pixels, and a peak-signal bookmark justification for Angeles National Forest chaparral during the 2021 drought.
- **Verification**: `node tests/test_atlas_lfmpi.mjs`; synthetic water and bare-soil samples return alpha `0`; synthetic dry vegetated fuel returns non-transparent output; all 91 atlas evalscripts still parse and return RGBA; browser smoke verified LFMPI info panel and peak-signal bookmark text.
- **Graduated to**: `knowledge/procedural/atlas_viewer_validation.md`.

## 2026-05-24: Sentinel Hub WMS Tile Errors from Quota Exhaustion — DIAGNOSED

- **Infrastructure error**: Browser verification of `http://localhost:4180/index.html` emitted repeated `[WMS] Tile Error: Object` console errors from `src/map.js`.
- **Observed response**: Direct WMS reproduction returned HTTP `403` with the Sentinel Hub service message `Insufficient processing units or requests available in your account. Upgrade account or acquire additional credits.`
- **Cause**: Sentinel Hub/CDSE account quota or request credits are exhausted for the configured WMS instance/account.
- **Impact**: Sentinel overlay tiles cannot load until quota/credits are restored, but the local app shell and basemap can still initialize.
- **Fix status**: App-side UX fixed. `src/map.js` now parses WMS error bodies when readable, `src/report.js` publishes Catalog API 401/403 details, and `src/app.js` shows one deduped quota-specific toast instead of repeated generic tile errors.
- **Graduated to**: `knowledge/procedural/debugging.md`.

## 2026-05-20: Test Harness Missing `puppeteer-core` — RESOLVED

- **Deterministic error**: `node tests/test.js` fails before running browser assertions with `Error: Cannot find module 'puppeteer-core'`.
- **Cause**: The repository currently has no `package.json`, no `package-lock.json`, and no local `node_modules/puppeteer-core` dependency, but `tests/test.js` starts with `require('puppeteer-core')`.
- **Impact**: The project test command listed in `AGENTS.md` cannot run in this checkout until the Node test dependency is installed or vendored via project package metadata.
- **Fix status**: RESOLVED on 2026-06-07. Added `package.json`/`package-lock.json` with `puppeteer-core`, made `tests/test.js` start an in-process static server, stubbed `config-v1.js` during browser smoke tests to avoid reading secrets, and scoped the smoke to credential-free app readiness.
- **2026-05-24 recurrence**: Reproduced during top bookmark removal validation. The error still occurs before any app assertions run.
- **2026-05-24 recurrence**: Reproduced during public-doc voice validation. The error still occurs before any app assertions run.
- **2026-06-07 recurrence**: Reproduced during Limn Atlas cold-review fix validation. The error still occurs before any app assertions run.
- **2026-06-07 recurrence**: Reproduced during LFMPI water false-positive validation. The error still occurs before any app assertions run.
- **2026-06-07 recurrence**: Reproduced during proof-grade bookmark pass validation. The error still occurs before any app assertions run.
- **Verification**: `node tests/test.js` now passes.
- **Graduated to**: `knowledge/domain/deps.md`.

## 2026-05-24: Node Test Harness Path Drift — RESOLVED

- **Deterministic error**: `node tests/test_pwi.js` and `node tests/test_evalscript.js` fail with `ENOENT: no such file or directory, open 'app.js'`.
- **Cause**: Both tests expected a root-level `app.js`, but the app code has been refactored under `src/app.js`.
- **Impact**: PWI formula test and evalscript compiler test were broken.
- **Fix status**: RESOLVED. Corrected the path in both scripts to `src/app.js`. For `test_evalscript.js`, also redirected the output to `src/test_evalscript_runner.mjs` and engineered `src/mocks.mjs` to allow native ESM test execution under Node.js without reference errors.

## 2026-05-20: Additional Node Test Harness Drift — RESOLVED

- **Deterministic error**: `node tests/test_fetch.js` fails before execution with `Error: Cannot find module 'node-fetch'`.
- **Cause**: The repository has no package metadata installing `node-fetch`, but the test imports it directly.
- **Impact**: Fetch/auth test cannot run in this checkout.
- **Fix status**: RESOLVED on 2026-06-07. Removed the `node-fetch` require and used Node 24's built-in global `fetch`.
- **Verification**: `node --check tests/test_fetch.js` and `node tests/test_fetch.js` run without dependency failure. The live Sentinel Hub FIS URL currently returns HTTP 404, so this remains a remote endpoint/content concern rather than a local dependency failure.

## 2026-03-17: Cold-Eyes Review Findings — RESOLVED

### Critical (Fixed)
- **`ReferenceError: showToast is not defined` in report.js** — `showToast()` called on lines 290, 303, 361 but never imported. Added `import { showToast } from './ui.js'` to report.js.
- **APEX layer blank tiles** — `getWMSLayer()` time-range expansion only checked for `hpwi`, not `apex`. Single-day ORBIT mosaicking returns 0 scenes. Fixed: added `activeIdx === 'apex'` to the 30-day expansion condition.
- **APEX cumulative mode crash** — APEX was not excluded from `genCumulativeEvalscript` wrapping (which is single-source only). Fixed: added `activeIndex !== 'apex'` exclusion alongside `hpwi`.

### Cleanup (Fixed)
- **`visibleCount` dead variable in `probeAcquisitions()`** — incremented but never read. Removed.
- **Debug `console.log` statements** — removed from `auth.js` (3 lines) and `app.js` (2 lines). Replaced with a proper error throw in `auth.js` when config is missing.
- **`console.log("INITIAL CONFIG CHECK...")` in index.html** — removed.

### Flagged (Not Fixed — Requires Product Decision)
- **Credentials hardcoded in `config-v1.js`** — fixed 2026-03-17 (see below). Auth still routes through `corsproxy.io` (third-party).

## 2026-03-17: Credentials & Scan Chart Data — RESOLVED

- **`config-v1.js` not gitignored** — credentials were committed. Added `config-v1.js` to `.gitignore`. Updated `config.example.js` to use the correct `window.CONFIG = { ... }` pattern with copy instructions.
  - ⚠️ The real credentials were previously committed and should be rotated on the Copernicus portal.

- **VSI/SCRI/TRI/BPI chart data was proxied** — FIS scan script expanded from 6 to 10 output bands. VSI (B6), TRI (B7), BPI (B8), LBI (B9) are now computed directly from S2 bands. Added B05 and B07 to script inputs for VSI (red-edge bands). Anomaly rule engine updated to include real LBI/TRI/BPI signals. SCRI remains null — it requires Sentinel-1 SAR unavailable in single-source S2 stats calls.

## 2026-03-17: Missing Imports & Broken Highlighting — RESOLVED

- **`ReferenceError: initRrcSpillOverlay is not defined`** — was called in `app.js` at line 568 but never imported from `report.js`. Fixed: added to import block.
- **`ReferenceError: downloadHTMLReport is not defined`** — HTML `onclick="downloadHTMLReport()"` calls a function that's an ES module export in `report.js` but was not exposed to `window`. Fixed: added to import and `window.downloadHTMLReport = downloadHTMLReport`.
- **`highlightAnomalies` silent bug** — `date-single` uses numeric array indices as `opt.value` (not date strings), but `anomalySet` contains date strings. Anomaly warnings never appeared on the single-date dropdown. Fixed: resolve date string via `ALL_DATES[parseInt(opt.value)]`.
- **`alert()` in scan error handler** — inconsistent UX. Replaced with `showToast()`.

## 2026-03-28: APEX/HPWI Zero-Scored Dry Brine Sites — RESOLVED

**Symptom:** APEX and HPWI scored 0.000 for 7/8 verified spill sites including the 357K BBL Crane County geyser. Only Lake Boehmer (a 60-acre saltwater lake) scored high (APEX 0.843, HPWI 0.814).

**Root cause:** Both APEX and HPWI formulas use `smoothness = (B03−B11)/(B03+B11)` as a surface roughness proxy. For dry Permian Basin bare soil and salt crust deposits, B11 (SWIR1, 1610nm) >> B03 (green, 560nm), giving NDWI ≈ −0.40 to −0.51. The normalised form `norm_smooth = max(0, (NDWI + 0.30) / 0.60)` → 0 exactly. Since HPWI = `chem_signal × norm_smooth × 6.0`, this zeroes the index entirely for dry sites. APEX uses the same formula for `apex_radar_proxy` and `apex_moisture`. Water bodies (Lake Boehmer) have B03 > B11 (positive NDWI), which is why only the lake was detected.

**Fix:** Added dry brine mode to both APEX and HPWI:
- Condition: `NDWI < −0.30 AND NDSI > 0.05 AND BSI > 0.10` (dry bare soil with elevated SWIR salt)
- Formula: `dry_score = (ndsi − 0.04) × min(1, bsi × N) × scale`
- Result: `score = max(wet_mode_score, dry_mode_score)` — complementary detection paths
- APEX: `(ndsi − 0.04) × min(1, bsi × 4.0) × 15.0`, clipped [0, 1]
- HPWI: `max(0, ndsi − 0.04) × min(1, bsi × 3.5) × 14.0`, clipped [0, 1]

**Variable ordering bug discovered:** `ndwi` and `bsi` were defined in the LBI/PWI sections, AFTER the HPWI block. Dry mode condition in HPWI used `smoothness` (identical formula, already available in HPWI block) and `bsi` was moved to shared intermediates at top of `calculate_indices()`.

**Detection delta:** APEX 29.6%→77.8%, HPWI 14.8%→66.7%, composite 38.1%→55.2%.
**Graduated to:** knowledge/procedural/validation-summary.md

## 2026-03-16: Basemap Visibility & Index TypeError

- **Deterministic error**: `Uncaught TypeError: Cannot read properties of undefined (reading 'hpwi')` in `map.js`.
- **Cause**: `getScriptContent` was destructuring `INDICES` from the `state` object, but `INDICES` resides in the `config` object.
- **Symptom**: Map overlays fail to render, and JS execution halts, preventing basemap initialization.
- **Fix**: Update `getScriptContent` to accept `config` or pass `INDICES` correctly.

- **Missing Logic**: Basemap initialization.
- **Cause**: During the Tier 1/Tier 2 refactor, the explicit `L.tileLayer(...).addTo(map)` for the initial basemap was lost or omitted in the new `DOMContentLoaded` flow.
- **Fix**: Add default basemap initialization in `app.js`.

## 2026-06-09: COG Backend Functional QC Findings — OPEN

- **Deterministic error**: COG tile requests for exposed indexes including `ehc`, `bpi`, `fbc`, `vsi`, `mvpi`, and `ndvi` returned HTTP 502 JSON instead of PNG tiles during direct tile probing.
- **Cause**: The COG renderer only declares COG band requirements for `tc`, `pwi`, `hpwi`, `pwoi`, and `lbi`. Unsupported index keys fall through to `render_index()`, which computes shared intermediates from `B11`/`B12` even when only true-color bands were loaded.
- **Impact**: Visible UI controls advertise unsupported analysis layers under the default COG provider, producing broken map overlays during demos.
- **Fix status**: OPEN. Either hide/disable unsupported COG lenses, route them to an explicitly labeled alternate provider, or implement their COG formulas before exposing them.

- **Deterministic error**: COG compare diff requests rendered byte-identical and pixel-identical tiles to the non-diff request for the same `hpwi` tile.
- **Cause**: The browser passes `diff` and `cumulative` query parameters to `/api/cog/tiles`, but `execution/render_cog_tile.py` ignores those parameters and only renders the target time window.
- **Impact**: Compare Diff/Cumulative modes appear functional while showing a normal single-date COG tile.
- **Fix status**: OPEN. Disable these controls in COG mode or implement temporal rendering in the COG pipeline.

## 2026-06-09: COG Prewarm Parsed Missing Coordinates as Zero — RESOLVED

- **Deterministic error**: Startup COG prewarm reported 4 errors and attempted a STAC search around bbox `(0.0, -0.02197, 0.02197, 0.0)` instead of the configured demo bookmarks.
- **Cause**: `Number(searchParams.get('lat'))` and `Number(searchParams.get('lng'))` turn missing query params into `0`, so a prewarm request containing only `limit`/`radius` was treated as an explicit ad hoc target at `0,0`.
- **Impact**: Startup prewarm did no useful work and could create confusing STAC/no-item errors.
- **Fix status**: RESOLVED. `targetFromSearch()` now requires actual `lat` and `lng` params before constructing an ad hoc target.

## 2026-06-09: COG Renderer Changes Reused Old Disk PNG Tiles — RESOLVED

- **Deterministic error**: After changing COG alpha presentation, live COG probes for previously rendered Lake Boehmer tiles still returned max alpha `255` from `.tmp/cog_tile_cache`.
- **Cause**: The disk cache key was based only on URL path/query params, not the renderer/presentation version.
- **Impact**: Visual fixes could appear missing until the temp cache was manually cleared.
- **Fix status**: RESOLVED. COG cache keys now include a renderer version constant so presentation/math changes naturally miss stale PNGs.

## 2026-06-09: Provider Contract Regex Typo — RESOLVED

- **Deterministic error**: `node tests/test_gee_provider.mjs` failed before assertions with `SyntaxError: Invalid regular expression` after adding Sentinel credit guard coverage.
- **Cause**: The regex literal for `state.map.fire('sentinelguard'` escaped the dot characters but did not escape the literal opening parenthesis.
- **Impact**: Focused provider contract could not run.
- **Fix status**: RESOLVED. Escaped the parenthesis in the regex.

## 2026-06-09: Sentinel Guard Browser Harness Clicked Hidden Settings Control — RESOLVED

- **Deterministic error**: The temporary Sentinel guard browser assertion failed with `Node is either not clickable or not an Element` when calling `page.click('#toggle-sentinel-live')`.
- **Cause**: The Settings pane containing the checkbox was not visible in the active layout pane, so Puppeteer's physical click target was not interactable.
- **Impact**: The first browser assertion could not complete even though the control existed.
- **Fix status**: RESOLVED. Reran the assertion by dispatching the checkbox and slider events in page context.

## 2026-06-09: Sentinel Toolbar Toggle Did Not Select Sentinel, Then Hit HTTP 429 — RESOLVED

- **Deterministic error**: Turning on the visible Sentinel toolbar switch did not initially prove Sentinel Hub was loading; after provider routing was fixed, Sentinel Hub returned HTTP 429 rate-limit errors during normal tile loading.
- **Cause**: The first toolbar implementation only armed the credit guard. It did not switch the active provider from COG/GEE to Sentinel Hub. After adding the provider switch, the WMS layer still used 256px tiles and four concurrent fetches, which could burst enough requests to trip Sentinel Hub account rate limits.
- **Impact**: The UI appeared to offer a Sentinel toggle, but it either stayed on COG/GEE or produced repeated red 429 tile-error toasts when live Sentinel rendering was reached.
- **Fix status**: RESOLVED. The toolbar switch now applies a session-only Sentinel Hub provider override and restores the default provider when switched off. WMS loading now uses 512px tiles, one concurrent fetch, `Retry-After` cooldown handling, and a `sentinelratelimit` UI status event.

## 2026-06-10: Atlas Sentinel 403 Hid Provider Detail — RESOLVED

- **Deterministic error**: Limn Atlas showed a generic `HTTP 403` tile-status message for Sentinel WMS failures, making quota, auth, layer, and date-coverage failures look the same.
- **Cause**: Atlas preserved the raw provider response body on fetch failure, but the visible tile-status formatter ignored provider details and did not parse Sentinel Hub XML `ServiceException` bodies.
- **Impact**: A PETI screenshot looked like the PETI/AGRICULTURE layer might be unsupported, even though a direct redacted probe of the current configured WMS returned `HTTP 200` with an `image/png` tile for PETI.
- **Fix status**: RESOLVED. Atlas now parses JSON, CDATA, and XML service-exception error bodies, classifies quota/credit 403s separately, and surfaces the provider detail in the map status.

## 2026-06-13: Atlas Article Capture WMS Probe Returned HTTP 403 — RESOLVED

- **Deterministic error**: The first `execution/capture_atlas_articles.py` run for Sentinel-only Atlas article assets failed before writing captures because the direct Sentinel Hub WMS true-color request returned HTTP 403.
- **Cause**: The default public Atlas WMS endpoint returned a Sentinel Hub `ServiceException` for insufficient processing units/requests.
- **Impact**: Article capture generation was blocked when the script used the old default endpoint.
- **Fix status**: RESOLVED. `execution/capture_atlas_articles.py` now privately reads the local configured Atlas/Sentinel WMS endpoint from `config-v1.js` when present and records only a redacted endpoint label in output metadata.

## 2026-06-13: Atlas Article Capture Catalog Query Returned HTTP 400/403 — RESOLVED

- **Deterministic error**: The Sentinel-only capture script wrote PNG assets successfully through WMS, but every optional Sentinel Hub Catalog side query returned HTTP 400.
- **Cause**: The first Catalog payload used WMS-style date-only ranges, which Sentinel Hub Catalog rejected with `Cannot parse parameter datetime`. After switching to ISO timestamp ranges, Sentinel Hub Catalog returned a processing-unit/credit 403.
- **Impact**: PNG captures initially had bookmark date, WMS date window, bbox, layer, and provider metadata, but exact scene/acquisition fields were missing.
- **Fix status**: RESOLVED. The capture script now uses public CDSE STAC as the primary metadata source for Sentinel scene metadata, returning item ID, acquisition datetime, platform, cloud cover, and sun geometry without using GEE or COG.

## 2026-06-24: Atlas Browser Smoke Blocked by Local Listen Permission — OPEN

- **Infrastructure error**: `node tests/test_atlas_sentinel_toggle.mjs` failed before launching the page with `listen EPERM: operation not permitted 127.0.0.1`.
- **Cause**: The current Codex sandbox does not permit binding a local HTTP server to `127.0.0.1`.
- **Impact**: The browser smoke could not verify the new Atlas capture-mode UI in this environment.
- **Repeat observation**: The same command failed with the same `listen EPERM` blocker during the capture usability follow-up after static checks passed.
- **Visual fallback observation**: The in-app browser rejected direct `file:///Users/danielbally/Git/limn/atlas.html` navigation by URL policy, so file-based visual verification was also unavailable in this environment.
- **Repeat observation**: The same `listen EPERM` blocker recurred while validating the Capture Split interpretation fix; static provider checks were used instead.
- **Fix status**: OPEN in this sandbox. Static checks passed, and the browser smoke should be rerun in a local environment that allows localhost binding.
# 2026-07-20 — Atlas bookmark QC WMS argument scope failure

**Symptom:** `python3 execution/qc_atlas_bookmarks.py` stopped before its first request with `NameError: name 'args' is not defined` in `build_wms_url()`.

**Cause:** The helper attempted to read the `main()`-local argparse namespace instead of receiving the selected WMS URL as an argument.

**Fix:** `build_wms_url()` now accepts `wms_url` explicitly, and `fetch_metrics()` passes `args.wms_url`. This keeps command-line endpoint overrides deterministic and removes hidden global state.

---
