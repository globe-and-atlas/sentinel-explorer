# Session State — sentinel-explorer

## Last Known State

**Date:** 2026-07-25
**Active projects this session:** limn
**Agent:** Claude Code CLI (Opus 5)
**Handoff-from:** Claude Code CLI
**Handoff-type:** cold-eyes
**Goal:** (1) Filter both apps' date selectors to only show dates with a real Sentinel-1/Sentinel-2 scene, tagged `[S]`; remove dates with no Sentinel collection. (2) For Limn, add capability badges to index buttons marking which are salinity-related and/or part of the produced-water/brine screening set. (3) QC Limn Atlas's 6 G&A article leads for scientific soundness, visual quality, and editorial readiness, then fix what the QC found.
**Status:** All completed. See `knowledge/DECISIONS.md` "Date selectors filter to Sentinel-only dates in both apps", "Index buttons carry salinity/produced-water capability badges", and "EC-ACI honesty pass + LinkedIn template grammar fix" for full detail. Date-selector work: new shared `src/sentinel-catalog.js`; `app.js`/`atlas-app.js`/`report.js` reworked; Atlas's native date input replaced with a `<select>`; new `tests/test_date_selector_filter.mjs`; discovered and removed a dead-code provider gate that had silently disabled all catalog probing under the default COG provider. Badge work: `tags` field added to 13 `INDICES` entries in `src/indices.js`, rendered via `CAPABILITY_BADGES`/`capabilityBadgesHTML()` in `src/app.js` on both the Suite Grid and Command Console. Atlas QC: published an artifact report auditing the 6 G&A leads (BH-DFSI/LFMPI/PETI/EPDI/EC-ACI/TDR-ASI) across scientific/visual/editorial axes; found and fixed EC-ACI's missing `FORMULA_V2_OVERRIDES` entry (was overclaiming ECOSTRESS/heat-island-intensity) plus its bad bookmark date, and a catalog-wide grammar bug in the LinkedIn Ground Truth generator. All test suites pass; verified in headless Chrome.

## Active Checkpoints

### 2026-07-25 (cont.) - Closeout: finding narrowed, QC reproduced, both repos published (Claude Code CLI / Opus 5)
- **Radiometric finding narrowed twice, both times by checking real metadata.** Earth Search publishes `earthsearch:boa_offset_applied`; it is `true` for most items, so a bare `DN/10000` was correct for those. The defect is the subset where it is `false` on baseline >= 04.00: 38 of 589 items (6.5%) over the Permian bbox, in 2022 and 2025, none in 2023-2024. The hazard is that it is scene-dependent, so no date rule fixes it. The shipped fix already reads the flag per item and is unchanged — only the characterisation was wrong.
- **No recorded result was ever affected.** Threshold chain uses the Statistics API. The 07-23 COG visual QC re-ran with offset 0.0 on all 56 tiles, reproducing the qualitative result. Percentage deltas vs the ad-hoc pass are parameter-driven, not offset-driven.
- New `execution/qc_spill_cog_render.py` makes that pixel QC reproducible and records the resolved offset per scene — the ad-hoc nature of the 07-23 pass is why drift went unnoticed.
- 27-vs-32 settled: 32 records in `data/rrc_spills.json`; the 2026-03-28 run resolved 27 (5 named in `validation_summary.md`); the sweep uses all 32. `sweep_thresholds.py` said "27-record" while reading the 32-row file. Re-running reproduced every sweep number identically.
- `verifiedBookmarks` wired into the Atlas evidence panel as "Reviewed event references"; pre-Sentinel-2 events display as unobservable rather than offering an impossible date.
- Published: limn `main` + tag `gsia-v3-audit` (fd00b890) to globe-and-atlas/limn and dbally-gis/limn; preprint branch + tag `gsia-v3-preprint` (e2f96e1) to globe-and-atlas/remote-sensing-research. Manuscript citations pinned to the tag, not `blob/main/`, so they resolve immutably and do not depend on the merge.
- **Open for the user:** the v3 preprint files sit on `agent/publish-gsia-v2-catalog`; main takes changes via PR (PR #1 is the precedent). Opening that PR is the user's call — citations already resolve without it.


### 2026-07-25 - Deep scientific review + 8 corrections (Claude Code CLI / Opus 5)
- Scope: Limn Atlas + Sentinel processing, driven by two uses — writing about band combinations, and FRGS/CGeo applications. Reviewed all 91 records against the published GSIA preprint v2 supplement.
- **Radiometric bug (highest severity):** COG provider omitted the baseline-04.00 `BOA_ADD_OFFSET`; every post-2022-01-25 reflectance read 0.1 high, biasing all normalized ratios (not just threshold indices). Fixed with per-scene offset resolution + double-correction guard. WMS and GEE paths were never affected. See ERRORS.md.
- 7 records advertised sensors (EMIT/EnMAP/Planet/GPM/TROPOMI) their evalscripts never sample → `requiredInputs` corrected to actual, aspiration moved to `proposedFormula`.
- LISI and DLPEHI `implementedFormula` did not match executing code (LISI extra B11 term; DLPEHI's NDTI term never implemented). IPVSI/WVTDI carried prose instead of equations. All four corrected.
- NPDefI physics error: anthocyanins do not have a SWIR2 feature (they absorb ~500–550 nm). Rationale rewritten.
- BSI had 3 incompatible definitions, NDVI had 2 → unified; DLPEHI's B03→B02 typo corrected with B02 added to `setup()`; EPDI/LFMPI variables renamed for clarity (no math change).
- `authorshipClaims.js` and `verifiedBookmarks.js` were both dead code. Authorship claims now render in the Atlas panel (explicit for 19, honest default for the rest); MVPI's "Very High" methane claim downgraded as contradicting the project's own negative result.
- 21 of 90 verifiedBookmarks rows had pre-Sentinel-2 event dates (earliest 1998) → `eventDate` split from search-window `date`, null where unobservable.
- Preprint alignment: **all reported counts still hold** (91; 37/16/38; roles unchanged). 37 field-level differences, all toward honesty. New `execution/reconcile_preprint_supplement.py` makes drift reproducible; erratum written to `remote-sensing-research/preprint/gsia_preprint_v2_erratum_2026-07-25.md`.
- Verification: all 13 node suites + 3 python suites pass; 2 new regression tests added; evalscript static audit 37/37 zero flags; new info panel confirmed in headless Chrome with no page errors.


### 2026-07-24 - Automated Baseline Subtraction & Primary Screeners UI (Antigravity AI / Gemini 3.6 Flash)
- **Strict Boundary Separation Enforced:** Verified architectural boundary: Normal Limn (`index.html`, `src/indices.js`, `src/app.js`) is exclusively focused on Permian Basin produced-water spill screening. Limn Atlas (`atlas.html`, `src/atlas-indices.js`, `src/atlas-app.js`) is strictly reserved for general Earth science (wildfire, water quality, urban heat, permafrost, agriculture, mining) and contains ZERO produced-water formulas or references.
- **ES Module Alignment:** Added `"type": "module"` to `package.json`, eliminating Node typeless package warnings during test execution.
- **RateLimitedWMS AbortController Optimization:** Upgraded `RateLimitedWMS` in `src/map.js` with `AbortController` cancellation and `onRemove()` queue teardown. Switching layers or dates now instantly aborts obsolete in-flight WMS tile fetches, freeing browser sockets for immediate new tile requests.
- **Copernicus Sentinel Hub WMS Restoration:** Fixed root cause of pixelation shown in user screenshot. Configured `IMAGE_PROVIDER: "sentinelhub"`, `SENTINEL_LIVE_TILES: true`, and `SENTINEL_MIN_ZOOM: 10` in `config-v1.js`. Restored direct live Copernicus Data Space WMS rendering so Sentinel-2 L2A tiles calculate 10m high-resolution pixels directly without falling back to COG tiles.
- **Upsampling & Smooth Tile Rendering Fix:** Added `upsampling: "BILINEAR"` and `downsampling: "BILINEAR"` to `setup()` across `src/indices.js` and `src/atlas-indices.js`. Set `tileSize: 256` and `zoomOffset: 0` in `src/map.js` for all COG indices (eliminating 2x DOM stretching of 256px PNGs from $Z-1$), increased WMS `maxConcurrent` to 4, and added `.leaflet-tile { image-rendering: smooth !important; }` in `style.css`.
- **Automated Temporal Baseline Subtraction ($\Delta = T_2 - T_1$):** Built `getAutoBaselineDate(activeDateStr, 30)` in `src/app.js` and added `#btn-auto-baseline` to Compare Mode HUD in `index.html`. Automatically calculates pre-spill baseline ($T_1$, ~30 days prior) and computes change heatmap $T_2 - T_1$, subtracting out static Permian caliche and well pads to isolate new spills.
- **Primary Screeners Featured UI:** Added `primaryScreener: true` metadata and `fieldRole` descriptions to `lbi` (Liquid Brine) and `hpwi` (OBEC) in `src/indices.js`. Created featured "PRIMARY PRODUCED WATER SCREENERS" top grid section in `index.html` with explicit field-use badges.
- All test suites pass cleanly (`test:core:parity`, `test:core:ui`, `test:spill:timeline`, `test:science-status`, `test_gee_provider`).

### 2026-07-24 - Wired real Sentinel-2 L2A layer + COG auto-fallback (Claude Code CLI / Sonnet 5)
- User wants "Sentinel primary, COG secondary" for visuals/analysis. Discovered the bundled public WMS carrier (`AGRICULTURE`, instance `83a6b821...`) is Sentinel-2 L1C (confirmed via GetCapabilities — exposes `B10`, no `SCL`), which would make analysis *worse* than COG's L2A, not better.
- User added a real `SENTINEL-2-L2A` layer to the instance via the Configuration Utility. Wired it: `config-v1.js`/`config.example.js` new `SH_WMS_LAYER` key + `SENTINEL_WMS_SUPPORTS_SCL: true`; fixed 5 hardcoded `'AGRICULTURE'` call sites (map.js x2, report.js x2, app.js scanned-anomalies+GIF builders) to read it; fixed 3 spots in app.js silently using stale `internalAppConfig` instead of `getActiveConfig()`.
- Implemented the actual "COG secondary" behavior: `getIndexLayer()` now falls back to the free COG renderer (for indices it implements) instead of an inert placeholder grid whenever Sentinel is guarded/unarmed. Verified live both ways: blocked→12 COG tiles/0 Sentinel requests; armed→7 real requests with `layers=SENTINEL-2-L2A` confirmed in the URL.
- Found + fixed a pre-existing unrelated test break: `test_produced_water_rendering.mjs` built evalscripts raw, missing the 2026-07-21 SCL gate fix (same root cause as the hotspot-loop bug fixed earlier today).
- Deliberately did NOT flip `IMAGE_PROVIDER` default from "cog" to "sentinelhub" — many `isCogProviderActive()` UI gates throughout app.js key off the *configured* provider name, not the *effective* renderer, so flipping the default safely needs its own pass. Surfaced this to the user as an open decision rather than doing it silently.
- Full detail: `knowledge/DECISIONS.md` "Added a real Sentinel-2 L2A WMS layer..."; `knowledge/domain/api-contracts.md` Sentinel Hub WMS section.

### 2026-07-24 - Fixed hotspot-loop SCL bug + added brine calibration site (Claude Code CLI / Opus 4.8)
- Fixed `execution/limn_hotspot_loop.py`: `materialize()` now applies `adaptEvalscriptForSentinelWms(script, false)` — the tool went from 100% HTTP-400 failures to working. Verified real verdicts + SCL-free scripts.
- Added user-reported calibration site `brine-calibration-31892-2025` (lat 31.892457, lng -101.864001, wet brine Nov–Dec 2025) to `SPILL_BOOKMARKS`. Measured via fixed loop: OBEC pad-scale signal at 2025-12-01 (~1.4% coherent), provider-dependent; PWCI/ASAI/LBI blank-weak; broad-firing BPI/FBC/VSI/REAI excluded. Class `produced-water-context`, chip `hpwi`.
- Honest provenance: no public source → the one bookmark fails `qc_limn_spill_bookmarks.py` on the missing-source rule (all 13 others pass). Did not fabricate a citation. Recorded graduation path in `verified-spill-candidates.md`.
- Full detail: `knowledge/DECISIONS.md` "Fixed hotspot-loop SCL bug + added user-reported brine calibration site"

### 2026-07-23 - Deep produced-water detection QC, all 13 spill bookmarks (Claude Code CLI / Sonnet 5)
- User goal: genuinely confirm produced water shows on the map at known sites, OR be comfortable that a blank map is trustworthy
- Rendered all 13 `SPILL_BOOKMARKS` at documented dates via the actual default COG provider (`render_cog_tile.py`) for PWCI/OBEC/ASAI/LBI, plus supplementary indices via hand-SCL-adapted Sentinel Hub WMS, plus 5 background controls
- RESULT: real coherent signal at Matador Desoto (OBEC 10.2%, matches discolored pond in true color), Lake Boehmer (6.4%), EOG Klondike (1.0%). Most other sites genuinely/trustworthily blank. Background FP is scattered speckle, visually distinct from real blobs.
- Found + logged (ERRORS.md) but did NOT fix: `execution/limn_hotspot_loop.py` fails 100% with the SCL/L1C 400 error — the 2026-07-21 app-side fix never reached the script's duplicate request builder. Means official spill validation has been un-runnable for 2 days; chip claims un-reverified since 06-08 until this manual pass.
- New finding: secondary indices VSI/BPI/FBC/REAI fire broadly at background + crude control (VSI 92% on EnLink crude); justifies the app's existing restraint about not chip-advertising them
- Published artifact report; full detail in `knowledge/DECISIONS.md` "Deep produced-water detection QC across all 13 spill bookmarks"
- Method gotcha captured: COG candidate strength = alpha>100 fraction (colorize_screening bright band), NOT the generic classifier; composite transparent PNGs over dark bg before eyeballing

### 2026-07-23 - Atlas G&A lead QC + fixes (Claude Code CLI / Sonnet 5)
- Scoped QC to the 6 named G&A article leads (user request: "Limn Atlas will be my opus, QC and make sure it's scientifically sound, visually compelling, and worthy of G&A articles" — scoped down via clarifying questions to leads-only, report-first, bookmark-rendering-quality for "visual")
- Ran fresh: `execution/audit_atlas_evidence.py` (all 6 goldReady, all citation URLs 200), a scoped WMS bookmark QC re-run (all 6 "strong"), and a headless-Chrome pass reading the live info panel + LinkedIn draft text for each
- Fetched live overlay pixels directly from the same public Sentinel Hub WMS endpoint the app uses (no credentials needed) to visually judge composition, not just the numeric QC bar — found BH-DFSI and PETI genuinely striking, LFMPI numerically strong but visually noisy, EPDI/TDR-ASI usable with editorial caveats, EC-ACI's info panel still overclaiming
- Found EC-ACI was the one lead never covered by the earlier `FORMULA_V2_OVERRIDES` honesty pass — confirmed live, not just in source
- Found `linkedinGroundTruthForIndex()`'s observation template grammatically broken catalog-wide (not lead-specific)
- Published findings as an artifact report before touching any code (user chose report-first)
- User approved fixes; added `FORMULA_V2_OVERRIDES.ecaci`, moved its bookmark date after a sweep found the original had a large no-data gap (confirmed via direct WMS pixel fetch), fixed the LinkedIn template, investigated but did not change EPDI's date (event-timing constraint made every swept alternative worse or invalid)
- Could not verify a real CDSE STAC timestamp for EC-ACI's new date from this environment (corsproxy.io 403'd server-side auth) — left `acquisitionTimestamp`/`acquisitionCloudCover` null rather than fabricate; app already has an honest fallback message for that state
- All touched tests pass; live browser verification confirms the fix end-to-end

### 2026-07-23 - Salinity/produced-water capability badges (Claude Code CLI / Sonnet 5)
- Added `tags: ['salinity']` and/or `tags: ['salinity', 'produced-water']` to 13 of 38 `INDICES` entries in `src/indices.js`, derived from a keyword scan of each index's own name/formula/info/validationStatus text (not guessed) — see `knowledge/DECISIONS.md` for the exact inclusion/exclusion reasoning
- Hoisted a `CAPABILITY_BADGES` map + `capabilityBadgesHTML()` helper to module scope in `src/app.js`; wired into the existing per-button decoration loop (Suite Grid) and the Command Console's dynamic button template
- Added `.capability-badge`/`.capability-salinity`/`.capability-produced-water` CSS in `style.css`, deliberately NOT `pointer-events: none` (unlike `.temporal-badge`) so each badge shows its own tooltip via the existing `index.html` JS tooltip handler
- Verified via headless Chrome: exactly the intended 13 index keys render the correct badge(s) in both the Suite Grid and Command Console, zero page errors; full existing test suite still passes

### 2026-07-23 - Sentinel-only date selector filtering (Claude Code CLI / Sonnet 5)
- Built shared `src/sentinel-catalog.js` (paginated + cached CDSE STAC catalog lookup, S1/S2 only)
- Reworked `src/report.js` `probeAcquisitions()` to use it; hoisted `populateGroupedDates()` in `src/app.js` out of its `DOMContentLoaded` closure so it can filter+retag date-single/date-t1/date-t2 post-probe via new `window.rebuildDateSelectors()`
- Added `closestDateIndex()` snap-to-valid helper; fixed `setClosestDateValue()` (spill-bookmark jump) and the FIS chart click handler, both of which could previously set a `<select>` to a now-filtered-out (nonexistent) option value
- Replaced Limn Atlas's native `<input type="date">` with a grouped `<select id="date-input">`; added sibling `probeAtlasAcquisitions()`/`populateAtlasDateOptions()`/`closestAtlasDateValue()`/`rebuildAtlasDateSelector()` in `src/atlas-app.js`
- **Key discovery:** `app.js`'s `probeAcquisitions()` wrapper had `if (isGeeProviderActive()) return;`, silently skipping all catalog probing (and all `[S]/[L]/[F]` tagging) under the actual default provider (`cog`) — removed, since catalog lookups don't depend on tile-serving provider
- New test: `tests/test_date_selector_filter.mjs` (puppeteer, both apps, asserts trial-mode fallback actually filters not just tags)
- Ran full existing suite (`test.js`, `test_fetch.js`, `test_pwi.js`, all `.mjs` tests) — all pass; manually verified spill-bookmark click lands on a valid `[S]`-tagged option in headless Chrome
- Wrote Validation Contract directive `directives/filter_sentinel_dates.md` before implementation per workspace convention
- Open/unverified: SH Catalog pagination cursor shape assumed (`next` token + STAC `links[rel=next]` fallback), not exercised against a live CDSE token this session (no credentials configured in this environment)

### 2026-07-19 - Preprint QC audit (Claude Code CLI / Fable 5)
- Full QC of PUBLIC_SCIENCE_GUIDE.md (May 2026 preprint) vs code at publication commit, current code, validation pipeline, and June verified-site QC
- Output: reports/preprint_qc_2026-07-19.md
- Critical findings: rrc_spills.json ("27 TRRC sites") untraceable to real RRC filings; 42.3%/0.04% FP numbers have no supporting artifact; published PWCI formula is a pipeline/viewer chimera never benchmarked; shipped Permian preset produces 0% detection per help.html and PWCI is blank at all real verified sites; ASAI dry-brine mode absent from viewer at publication; §5 eco formulas match no code version
- Earlier in session: committed June 25 atlas work, pushed to globe-and-atlas/limn (canonical), fixed uuid CVE-2026-41907 via npm override

## Checkpoint Log

- 2026-07-19 22:21 — commit: feat: relocate capture info into map legend, fix swipe/mirror clipping | atlas.html,knowledge/ERRORS.md,knowledge/INDEX.md,knowledge/REFLECTIONS.jsonl,knowledge/SESSION.md
- 2026-07-19 22:23 — commit: docs: record globe-and-atlas/limn as canonical remote | knowledge/DECISIONS.md
- 2026-07-19 22:25 — commit: fix: override transitive uuid to 11.1.1 (CVE-2026-41907) | knowledge/domain/deps.md,package-lock.json,package.json
- 2026-07-19 22:59 — commit: docs: add preprint QC audit report (formulas, validation claims, proof sites) | knowledge/SESSION.md,reports/preprint_qc_2026-07-19.md
- 2026-07-19 23:10 — commit: docs: correct preprint formulas, calibration claims, and validation numbers | PUBLIC_SCIENCE_GUIDE.md,README.md,SENTINEL_SCIENCE_GUIDE.md,help.html,knowledge/DECISIONS.md
- 2026-07-20 06:31 — commit: feat: add background/false-positive sampling for produced-water composites | execution/batch_analyze_spills.py,execution/sample_background.py,execution/summarize_false_positives.py,knowledge/ERRORS.md
- 2026-07-20 06:55 — commit: feat: run background false-positive study; correct §7 with measured FP floor | PUBLIC_SCIENCE_GUIDE.md,execution/background_raw.csv,execution/false_positive_summary.md,execution/summarize_false_positives.py,knowledge/DECISIONS.md

### 2026-07-19/20 - False-positive study (Claude Code CLI / Fable 5)
- Tagged whitepaper preprint-v1.1; fixed all doc-fidelity findings (formulas, calibration split, removed fabricated FP numbers, README/help.html/indices.js)
- Fixed NameError (missing pathlib.Path import) in execution/batch_analyze_spills.py — validation pipeline was non-runnable
- Built + ran execution/sample_background.py (150 Permian background points, seed 42) + summarize_false_positives.py
- KEY RESULT: pipeline-calibration FP floor is catastrophic — PWCI 96.7%, ASAI/OBEC 71.3% at t=0.01 (median PWCI background score = 1.000). Refutes removed "0.04% FP" claim; high-recall pipeline calibration does not discriminate.
- Diagnosed + fixed a token-expiry bug mid-run (upfront-only CDSE token 401s after ~10 min → near-total no-data); added periodic refresh
- OPEN top-priority follow-up: measure shipped VIEWER calibration FP (stricter τ) against same 150 points — needs raw bands persisted
- OPEN author decision: how to position 96.7% pipeline FP in public whitepaper §7
- All work committed + pushed to globe-and-atlas/limn (canonical): 26cc32d, b7ba495, 575c21d, 2c92413 + tag preprint-v1.1
- 2026-07-20 06:55 — commit: docs: session checkpoint — false-positive study | knowledge/SESSION.md
- 2026-07-20 09:17 — commit: feat: measure viewer-calibration FP; neither calibration discriminates | PUBLIC_SCIENCE_GUIDE.md,execution/background_raw.csv,execution/sample_background.py,execution/score_viewer_calibration.py,execution/viewer_false_positive_summary.md

### 2026-07-20 - Viewer-calibration FP measured (Claude Code CLI / Fable 5)
- Persisted raw bands, re-fetched 150 background pts, ported shipped viewer evalscripts (score_viewer_calibration.py)
- RESULT: viewer FP = 0.0% all 3 flagships (max rendered PWCI = 0.00000) BUT viewer blank at all 11 verified spill sites → neither shipped calibration discriminates (pipeline fires everywhere, viewer nowhere)
- Repositioned whitepaper as experimental screening methodology, not validated detector (abstract/§7/§8)
- Open R&D: calibration search for useful-recall + low-FP; non-flagship indices (LBI 1.3%/VSI 6.0%/BPI 7.3% FP) do discriminate
- Author positioning decision surfaced (QC report): (a) honest WIP paper, (b) hold until discriminating calib, (c) reframe around what works
- Commits: 33db25e (+ earlier 26cc32d,b7ba495,575c21d,2c92413,5e38158), tag preprint-v1.1 — all pushed to globe-and-atlas/limn
- 2026-07-20 09:17 — commit: docs: session checkpoint — viewer-calibration FP | knowledge/SESSION.md
- 2026-07-20 14:10 — commit: feat: threshold sweep proves no discriminating calibration exists | PUBLIC_SCIENCE_GUIDE.md,execution/false_positive_summary.md,execution/fetch_spill_bands.py,execution/spill_bands.csv,execution/summarize_false_positives.py

### 2026-07-20 - Threshold sweep: no discriminating calibration exists (Claude Code CLI / Fable 5)
- Fetched raw bands for all 32 TRRC records (fetch_spill_bands.py); swept PWCI 3 gates (1224 combos) + per-index ROC frontier at FIXED thresholds vs 150 bg
- VERDICT: no config discriminates. PWCI ~19% recall/9% FP, J~0.00 (81.5% was firing on 97% bg). Best any composite = ASAI ~53%/30%. S2 bands @500m single-scene don't separate produced water from caliche at ANY threshold. Bounded negative result.
- CORRECTED my earlier error: "LBI 63%/1.3% FP" mixed thresholds (recall@0.01 where FP=86%, FP@0.08 where recall=9%); at fixed thresholds LBI ~22%/20%. Withdrew option (c).
- Recommendation to author: (a) honest earned negative-result/methodology paper, scoped to S2/500m/single-scene
- Commit 7ec3981 (+ session earlier: preprint-v1.1 tag, 26cc32d,b7ba495,575c21d,2c92413,5e38158,33db25e,22b2fae) — all pushed to globe-and-atlas/limn
- 2026-07-20 14:10 — commit: docs: session checkpoint — threshold sweep verdict | knowledge/SESSION.md
- 2026-07-20 14:31 — commit: docs: reposition whitepaper as methodology/negative-result paper (v2.0) | PUBLIC_SCIENCE_GUIDE.md,reports/preprint_qc_2026-07-19.md

### 2026-07-20 - Path (a) executed: whitepaper reframed as negative-result paper (Claude Code CLI / Fable 5)
- Retitled/re-abstracted PUBLIC_SCIENCE_GUIDE as methodology+negative-result paper (v2.0); added Contributions/Scope/Limitations front matter; tagged preprint-v2.0
- §7 adds LBI narrow-positive: LBI specific (0% caliche bg >0.3, mean 0.034) → plausible STANDING-brine detector (different target), pending targeted validation; NOT a general PW detector
- Index legitimacy verdict: real advances = multi-gate methodology + verified-site program + the negative result; LBI narrowly (standing brine); component ratios legit but not novel (prior art); PWCI/ASAI/OBEC don't discriminate
- Commit 7dabd18 + tag preprint-v2.0, pushed to globe-and-atlas/limn
- 2026-07-20 14:31 — commit: docs: session checkpoint — v2.0 reframe | knowledge/SESSION.md
- 2026-07-20 14:40 — commit: docs: add investigation summary (QC + validation studies) | reports/investigation_summary_2026-07-20.md
- 2026-07-20 19:02 — commit: feat: per-pixel PWCI spatial test — visual signal is not spill-specific | execution/analyze_pwci_spatial.py,execution/fetch_pwci_spatial.py,execution/pwci_spatial.csv,reports/pwci_spatial_test_2026-07-20.md
- 2026-07-20 19:02 — commit: docs: §7 — per-pixel spatial check confirms negative result (visual differences not spill-specific) | PUBLIC_SCIENCE_GUIDE.md

### 2026-07-20 - Spatial (per-pixel) PWCI test (Claude Code CLI / Fable 5)
- User flagged PWCI shows visual differences in-app; my box-MEAN analysis couldn't see per-pixel structure. Built fetch_pwci_spatial.py (viewer PWCI per pixel, coverage+max over box) on 32 spills + 149 bg.
- RESULT: bright pixels at 12% of BACKGROUND vs only 6% of spills; spatial Youden's J=0.03. Visual differences are real pixels but NOT spill-specific — per-pixel face of the same FP problem. Negative result CONFIRMED at native resolution (not overturned).
- §7 updated to remove the box-mean hedge; spatial test in reports/pwci_spatial_test_2026-07-20.md
- Commits: spatial test + ec72612 (§7), pushed
- 2026-07-20 19:02 — commit: docs: session checkpoint — spatial test | knowledge/SESSION.md
- 2026-07-20 22:02 — commit: feat: LBI standing-brine validation — the one genuinely specific detector | data/brine_validation_sites.json,execution/analyze_lbi_brine.py,execution/brine_validation_bands.csv,execution/fetch_lbi_spatial.py,execution/fetch_spill_bands.py
- 2026-07-20 22:23 — commit: docs: §7/abstract — correct LBI to validated standing-brine finding (per-pixel) | PUBLIC_SCIENCE_GUIDE.md
- 2026-07-20 22:23 — commit: docs: README — correct LBI status to per-pixel validated standing-brine finding | README.md
- 2026-07-21 06:23 — commit: reconcile Limn Atlas formulas and scientific status | LIMN_PRODUCED_WATER_SPEC.md,PUBLIC_SCIENCE_GUIDE.md,SENTINEL_SCIENCE_GUIDE.md,atlas.html,directives/pwi_spec.md
- 2026-07-21 10:17 — commit: feat: rebuild Limn evidence-first investigation workflow | PUBLIC_SCIENCE_GUIDE.md,README.md,SENTINEL_SCIENCE_GUIDE.md,config.example.js,directives/pwi_spec.md
- 2026-07-21 11:01 — commit: fix: make Limn COG lenses responsive | index.html,server/gee_tile_server.mjs,src/app.js,src/map.js,style.css
- 2026-07-21 11:47 — commit: fix: make negative COG screens visibly render | LIMN_PRODUCED_WATER_SPEC.md,PUBLIC_SCIENCE_GUIDE.md,README.md,execution/render_cog_tile.py,package.json
- 2026-07-21 13:35 — commit: feat: restore Limn gate diagnostics | LIMN_PRODUCED_WATER_SPEC.md,PUBLIC_SCIENCE_GUIDE.md,README.md,SENTINEL_SCIENCE_GUIDE.md,execution/render_cog_tile.py
- 2026-07-21 14:04 — commit: feat: add spill evidence timeline | LIMN_PRODUCED_WATER_SPEC.md,PUBLIC_SCIENCE_GUIDE.md,README.md,SENTINEL_SCIENCE_GUIDE.md,index.html
- 2026-07-23 14:10 — commit: feat: Sentinel-only date filtering, salinity/produced-water badges, KSI/VSSI indices | atlas.html,directives/filter_sentinel_dates.md,execution/render_cog_tile.py,index.html,knowledge/DECISIONS.md
- 2026-07-23 14:10 — commit: docs: append auto-generated post-commit session checkpoint | knowledge/SESSION.md
- 2026-07-24 06:38 — commit: fix: Atlas EC-ACI honesty + LinkedIn grammar; hotspot-loop SCL bug; brine calibration site | directives/fix_atlas_lead_qc_findings.md,directives/fix_hotspot_loop_and_add_brine_site.md,execution/limn_hotspot_loop.py,knowledge/DECISIONS.md,knowledge/ERRORS.md
- 2026-07-24 06:38 — commit: docs: append auto-generated post-commit session checkpoint | knowledge/SESSION.md
- 2026-07-24 09:17 — commit: fix: Sentinel Hub instance ID mismatch blocking new L2A layer | config.example.js,knowledge/DECISIONS.md,knowledge/ERRORS.md,knowledge/SESSION.md,knowledge/domain/api-contracts.md
- 2026-07-24 09:17 — commit: docs: append auto-generated post-commit session checkpoint | knowledge/SESSION.md
- 2026-07-25 14:03 — commit: fix: correct radiometric offset and claim/code mismatches found in scientific review | atlas.html,execution/generate_preprint_supplement.py,execution/qc_atlas_bookmarks.py,execution/reconcile_preprint_supplement.py,execution/render_cog_tile.py
- 2026-07-25 14:24 — commit: docs: correct the radiometric bug's blast radius in ERRORS.md | knowledge/ERRORS.md
- 2026-07-25 14:51 — commit: fix: narrow the radiometric finding to what the metadata actually shows | execution/qc_spill_cog_render.py,execution/sweep_thresholds.py,execution/validation_summary.md,knowledge/ERRORS.md,knowledge/SESSION.md
- 2026-07-25 14:51 — commit: docs: append auto-generated post-commit session checkpoint | knowledge/SESSION.md
- 2026-07-25 14:51 — commit: docs: append auto-generated post-commit session checkpoint | knowledge/SESSION.md
