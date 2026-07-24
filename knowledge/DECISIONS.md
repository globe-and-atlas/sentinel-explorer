# Architecture Decisions — sentinel-explorer

## Added a real Sentinel-2 L2A WMS layer; COG now falls back automatically when Sentinel is guarded (2026-07-24)

**Context:** User wants "Sentinel primary, COG secondary" for analysis. Investigation found the bundled public Sentinel Hub WMS carrier (`AGRICULTURE` on instance `83a6b821...`) is **Sentinel-2 L1C** (confirmed via `GetCapabilities`: exposes `B10`, the L1C-only cirrus band; no `SCL` layer) — top-of-atmosphere reflectance, no cloud masking. COG (`render_cog_tile.py`) reads `sentinel-2-l2a` from Earth Search with SCL masking. The produced-water/salinity formulas are defined on surface reflectance, so L1C-Sentinel would have made analysis *worse*, not better. User added a genuine `SENTINEL-2-L2A` layer (Source: "Sentinel-2 - L2A") to the same instance via the Configuration Utility to fix this.

**What was wired:**
- `config-v1.js` / `config.example.js`: added `SH_WMS_LAYER` (new key — Limn's WMS layer name was previously hardcoded, unlike Atlas's existing `ATLAS_WMS_LAYER`), set to `"SENTINEL-2-L2A"` for both apps; `SENTINEL_WMS_SUPPORTS_SCL: true` (now genuinely true, not a lie).
- Fixed 5 call sites that hardcoded `'AGRICULTURE'` instead of reading the new config key: `map.js` `getWMSLayer()` and `updateGifInset()`, `report.js`'s HTML-export and offline-report builders, `app.js`'s scanned-anomaly thumbnail builder and diff/index GIF builder.
- Also fixed 3 spots in `app.js` that built WMS requests from the raw `internalAppConfig` module defaults instead of `getActiveConfig()`'s config-v1.js-merged result — they were silently ignoring every runtime config override (layer name, SCL flag, calibration basin, everything). Same root-cause class as fixing the layer name; without this, `config-v1.js`'s new settings would only reach the main map view, not reports/GIFs.
- **`getIndexLayer()` in `map.js`:** when the requested provider is `sentinelhub` and the credit guard blocks it (unarmed, rate-limited, or below min zoom), it now renders the **free COG layer** for any index COG implements, instead of an inert placeholder grid — this is the actual "COG secondary/fallback" behavior. Still fires the `sentinelguard` event (now carrying `fallback: 'cog'`) so the UI toast explains the swap instead of the map just going quiet.
- Along the way, found and fixed a **pre-existing, unrelated test failure**: `tests/test_produced_water_rendering.mjs` built `evaluatePixel` directly from raw `INDICES[key].evalscript`, which has required an `SCL` band since 2026-07-21 — synthetic test samples have no `SCL` property, so the gate zeroed every result before the formula ran. Same fix pattern as the `limn_hotspot_loop.py` SCL bug: apply `adaptEvalscriptForSentinelWms()` before building the function.

**Verified live (headless Chrome, both guard states):**
- Guard blocked (default/unarmed): provider resolves to `sentinelhub`, guard blocks it, **0 Sentinel requests fired**, **12 real COG tiles rendered** instead of the old placeholder.
- Guard armed: **7 real Sentinel WMS requests fired**, `layers=SENTINEL-2-L2A` confirmed in the actual request URL (not `AGRICULTURE`).

**What was deliberately NOT changed:** `config-v1.js`'s `IMAGE_PROVIDER` is still `"cog"` — Sentinel is not yet the *default* provider on a fresh session; it's available correctly (real L2A + SCL) via the existing UI toggle. Making Sentinel the actual default requires more than a config flip: many `isCogProviderActive()`/`isGeeProviderActive()` conditionals throughout `app.js` gate UI affordances (which indices are selectable, analytics-button availability, temporal-mode constraints) on the *configured* provider name, not the *effective* one — flipping the default while guard-blocked would silently change which indices the UI allows a user to pick, even though rendering itself now degrades gracefully to COG either way. This needs its own pass before it's safe to flip; left as an open follow-up, not done silently.

**Follow-up (2026-07-24, same day) — `config-v1.js` was pointing at the wrong Sentinel Hub instance.** After creating the `SENTINEL-2-L2A` layer above, the live app still 400'd with "Layer SENTINEL-2-L2A not found." First `GetCapabilities` check showed the layer genuinely hadn't saved (UI validation on "Data processing" likely blocked it); user recreated it and it saved. But the app *still* 400'd — a second `GetCapabilities` probe against the exact URL `getActiveConfig()` resolves to showed the layer still missing there. Root cause: `config-v1.js`'s `SH_WMS_URL` was pinned to instance `83a6b821...`, while `src/app.js`/`charts.js`/`report.js`/`atlas-app.js` all already hardcode a *different* instance (`959ea2c5...`) as their internal fallback default — and that's the instance the user had actually been creating the layer on in the browser. `config-v1.js`'s explicit override was winning the `getActiveConfig()` merge and silently redirecting every request to the wrong (layer-less) instance. Fixed by updating `SH_WMS_URL` in `config-v1.js` to the `959ea2c5...` instance, eliminating the divergence. Verified with a direct `GetMap` request (not just `GetCapabilities`): HTTP 200, `image/png`, ~170KB non-empty tile over the brine calibration bbox. **Lesson:** when a Sentinel Hub layer error persists after fixing the layer itself, verify `GetCapabilities` against `getActiveConfig().SH_WMS_URL` specifically — a stale instance-ID override produces an identical "not found" symptom to an unsaved layer.

---

## Fixed hotspot-loop SCL bug + added user-reported brine calibration site (2026-07-24)

**Two follow-ups from the 2026-07-23 deep produced-water QC.** Directive: `directives/fix_hotspot_loop_and_add_brine_site.md`.

**Fix 1 — `execution/limn_hotspot_loop.py` SCL adaptation.** The official spill re-validation tool had been failing 100% of requests since 2026-07-21 with `HTTP 400: Collection 'S2L1C' has no band 'SCL'` (see ERRORS.md). Root cause: its inline Node `materialize()` applied calibration placeholders + the VISUAL_FILTER prefix but never called `adaptEvalscriptForSentinelWms()`, the step `getScriptContent()` (`src/map.js`) uses to strip the L2A-only SCL band before hitting the public L1C `AGRICULTURE` WMS layer. Fix: imported `adaptEvalscriptForSentinelWms` into the embedded Node code and wrapped `materialize()`'s return in `adaptEvalscriptForSentinelWms(finalScript, false)` as the final transform, matching the app's ordering. Verified: 4/4 flagship requests at 2 sites + a full 10-index sweep at the new site all return `ok` with real verdicts; every optical evalscript confirmed SCL-free after adaptation.

**Fix 2 — user-reported brine calibration site.** User provided lat 31.892457 / lng -101.864001, "wet brine activity Nov–Dec 2025," to use as a testing/calibration area. Added as `SPILL_BOOKMARKS` entry `brine-calibration-31892-2025`. Measured with the now-fixed loop (±45-day sweep, 10 indices): peak coherent signal is **OBEC at 2025-12-01 (~1.4% largest component)** — pad-scale blobs matching well pads in true color, over an active oilfield cluster. PWCI/ASAI/LBI blank-to-weak; BPI/FBC/VSI/REAI "strong" but these are the broad-firing/unreliable indices flagged 2026-07-23 (fire at background + crude control), so excluded. Classified `produced-water-context` with `indices: ['hpwi']`.

**Honest-provenance call:** the site has NO public regulator filing — only the user's observation. So `execution/qc_limn_spill_bookmarks.py` correctly reports this one bookmark as `fail` on the missing-source rule (all 13 pre-existing still pass). Did **not** paper over it by fabricating a citation — a Copernicus Browser link is explicitly disallowed as a numbered source (2026-06-16 rule in `verified-spill-candidates.md`). This is the provenance gate working as designed for a user-reported target; recorded in `verified-spill-candidates.md` with the path to graduate it (find a public NMOCD/TRRC/news source). Also noted a real UX caveat: the OBEC signal is scene/provider dependent (visible via Sentinel WMS, faint on the default COG scene), documented in the bookmark note.

---

## Deep produced-water detection QC across all 13 spill bookmarks (2026-07-23)

**Context:** User asked for a thorough re-verification: "I truly want to find produced-water at known dates or feel comfortable if nothing obvious gets shown on map." Ran a fresh, live QC of all 13 current `SPILL_BOOKMARKS` at their documented dates/coordinates. Report published as an artifact (not committed).

**Headline result — reassuring:** Real, human-legible produced-water/brine signal *does* render on the current default map at three independently-documented sites: **Matador Desoto Spring Pond** (OBEC 10.2% candidate coverage, tight rectangle matching a visibly discolored pond in true color — the single strongest result), **Lake Boehmer** (OBEC 6.4%, matches the chronic brine lake's shoreline shape), and **EOG Klondike Pit** (OBEC 1.0%, small but coherent). Where the map shows nothing — most sites, most of the time — it is mostly a *trustworthy* nothing: COG's `colorize_screening()` muted "screened, no flag" veil (alpha≈38) is structurally distinct from a failed/blank tile, and background-point false positives are visually distinguishable from real detections (scattered specks vs. a coherent blob).

**Method note for future QC:** COG candidate strength must be measured as the fraction of pixels with alpha > 100 (the bright "candidate" band in `colorize_screening()`), NOT the generic visible-pixel or high-chroma metric `qc_atlas_bookmarks.classify()` uses — that generic metric reads COG's uniform faint veil as "100% visible, 0% high" for every site and is useless for COG. WMS renders (which use `colorize()`/hard alpha gates) can use the standard classifier. This distinction cost real time to spot; the raw transparent PNGs also must be composited over a dark background before visual inspection or they read as near-blank.

**Specificity confirmed against background:** Reused 5 points from `execution/background_raw.csv` (the March-2026 FP study's own sample). PWCI crossed its candidate threshold on 0.6%/0.3% of two background points — *higher* than most real spill sites — but as scattered isolated pixels, never a shape. This reconfirms the 2026-07-20 threshold-sweep verdict (no PWCI calibration discriminates) via a completely independent rendering pipeline (COG vs. the pipeline's own Python).

**New finding beyond prior FP studies:** The secondary indices `vsi`, `bpi`, `fbc`, `reai` fire "strong" broadly, at background points and the crude-oil negative control alike (VSI hit 92% high-signal coverage on the EnLink crude control). Prior FP work only studied the 3 flagships. This is not a live problem *because* the app doesn't advertise these as evidence chips (only `bpi` on one explicitly-labeled context site) — the existing chip restraint is now data-justified, not just cautious. Recommendation: do not promote these to chips without dedicated FP work.

**Bug found (logged in ERRORS.md, NOT yet fixed):** `execution/limn_hotspot_loop.py` — the official spill re-validation tool — fails 100% of requests with `HTTP 400: Collection 'S2L1C' has no band 'SCL'`. The 2026-07-21 SCL-adaptation fix reached the app (`getScriptContent()` → `adaptEvalscriptForSentinelWms()`) but not this script's duplicate `build_wms_params()`. Consequence: every "OBEC/LBI strong at X" chip claim in `SPILL_BOOKMARKS` dates from 2026-06-07/08 and was un-reverifiable until this session did it by hand. The one-line fix (add the same adapter call before base64-encoding) is described in ERRORS.md.

**One inconclusive site:** `crane-crevice-2023`'s COG tile came back diagonally half-covered (single-scene, no mosaicking in the renderer) — its 0.00% is over the covered half only. Treat as untested, not confirmed-negative, until re-checked at a different zoom.

---

## EC-ACI honesty pass + LinkedIn template grammar fix (2026-07-23)

**Decision:** Fixed two findings from a QC pass on the 6 G&A article leads (BH-DFSI, LFMPI, PETI, EPDI, EC-ACI, TDR-ASI): EC-ACI was the one lead missing from `FORMULA_V2_OVERRIDES`, and `linkedinGroundTruthForIndex()`'s observation template produced broken sentences catalog-wide.

**EC-ACI:** Added a `FORMULA_V2_OVERRIDES.ecaci` entry (`src/atlas-indices.js`) — renamed "Evapotranspirative Canopy & Asphalt Contrast Index" → "Urban Canopy-Loss & Dry-Surface Context Index," corrected `platform` from "Sentinel-2 + ECOSTRESS" (no ECOSTRESS/thermal data is actually read) to "Sentinel-2," and rewrote `physics`/`benefit` to match the sibling leads' hedged pattern instead of stating "urban heat islands form..." and "maps urban heat island intensity" as fact. The original `articleAngle` in `ARTICLE_LEADS` had already been softened to "exposed-surface and low-canopy context" at some earlier point — that correction never reached the info panel or the LinkedIn generator, which is what actually surfaces to a reader/editor.

**EC-ACI bookmark date:** Also moved 2021-07-20 → 2021-07-05. The original date's live WMS response had a large no-data rectangle covering roughly a third of the tile (visible in a direct-fetch pixel check, and its QC signal score was ~35 versus 60-85 for every neighboring date in a ±60-day/step-15 sweep — an outlier-low score turned out to correlate with the bad tile). 2021-07-05 renders full-frame with a stronger urban/desert contrast and stays inside the same summer-heat window the citations (WMO, Maricopa County, AZ DHS) describe. Could not verify a real CDSE STAC acquisition timestamp for the new date from this environment (`corsproxy.io` 403'd a server-side auth attempt even with real credentials — appears to specifically block non-browser requests), so `acquisitionTimestamp`/`acquisitionCloudCover` were left `null` rather than inventing plausible numbers; the app already has an honest fallback message for this state.

**EPDI investigated, not changed:** Same sweep run for EPDI (its render has a smaller no-data gap). Every candidate before 2023-03-17 predates the Pajaro River levee breach the bookmark documents, breaking the "sediment pulse after the breach" narrative; the two post-breach alternatives tested (2023-04-01, 2023-05-16) both still showed a gap, one larger. Kept the current date — documented in-code and in `directives/fix_atlas_lead_qc_findings.md`. Mitigation is editorial (crop tight rather than the full bookmark extent), not a code fix.

**LinkedIn template:** `linkedinGroundTruthForIndex()`'s `observation` was `"${acronym} uses ${bands} to make ${physics-first-sentence}"` — every method's `physics` field is written as its own complete sentence, so splicing it after "to make" produced grammatically broken output for the whole catalog (confirmed on all 6 leads before the fix, e.g. "BH-DFSI uses B02... to make the live layer combines low NBR..."). Changed to two short sentences: `"${acronym} uses ${bands}. ${firstSentence(idx.physics, idx.name)}"`. Removed the now-unused `sentenceCase()` helper it depended on. Spot-checked 5 non-lead entries post-fix — clean.

**Verification:** `node --check` on both touched files; `test_atlas_formula_v2.mjs`, `test_atlas_capability_families.mjs`, `test_atlas_sentinel_toggle.mjs`, `test_atlas_gee_smoke.mjs` all pass; live headless-Chrome pass over all 6 leads confirms the corrected info-panel text, the corrected bookmark date, the honest null-timestamp fallback message, and grammatically clean `gtObservation` text, with zero console errors.

---

## Index buttons carry salinity/produced-water capability badges (2026-07-23)

**Decision:** Added a `tags` array field to 13 of Limn's 38 `INDICES` entries in `src/indices.js` (`ndsi`, `si`, `ksi`, `crsi`, `vssi`, `lbi`, `pwoi`, `scri`, `pwi`, `hpwi`, `fbc`, `reai`, `vcbi`), each `'salinity'` and/or `'produced-water'`. A small 🧂/🛢️ badge now renders on the corresponding index buttons in both the main Suite Grid and the Command Console search results, with a hover tooltip, so a user doesn't have to open every index's info panel or guess which button to click for a salinity or produced-water/brine screening task.

**Categorization method — not a guess:** Ran a keyword scan (`salin|brine|chlorid|salt`) across every index's own `name`/`formula`/`info`/`validationStatus` text, then manually excluded hits that were pure disclaimers ("not a salinity measurement", "not a chloride retrieval") versus hits where the index's own designed hypothesis is actually about salinity/brine. **Salinity** = the index's own name or description frames it as a salinity/salt/brine-hypothesis proxy (even while disclaiming validation) — e.g. `ksi` is literally "Khan Salinity Index," `ndsi`'s own info calls it "a salinity-hypothesis component." **Produced-water** = the narrower subset the app itself already treats as its dedicated produced-water/brine screening set — verified via `HIGHLIGHT_THRESHOLDS`' own inline comments (`// Forensic Brine Composite` for `fbc`, `// Hot-Pixel PW Index` for `hpwi`, `// Active liquid brine after stricter wet/bare gates` for `lbi`) plus each entry's literal name (`pwi` = "Produced-Water Contrast Index," `pwoi` = "formerly PWOI," `hpwi` = "legacy Oil-Brine Emulsion Composite"). Excluded from produced-water despite having an internal NDSI/"brine" gate as one ingredient: `reai`, `vcbi`, `ndsi`, `si`, `ksi`, `crsi`, `vssi`, `scri` — none of these are in `HIGHLIGHT_THRESHOLDS` with a produced-water-specific comment, and their own docs frame them as general surface/vegetation/mineralogy proxies, not produced-water tools.

**Why this framing matters:** Limn's whole posture (see the evidence-first stack decision above) is that none of these composites are validated detectors — badges label a *screening hypothesis category*, not a claim of detection capability. The tooltip text on both badge types repeats this explicitly.

**Implementation:** `CAPABILITY_BADGES` map + `capabilityBadgesHTML()` helper hoisted to module scope in `src/app.js`; rendered via the existing per-button decoration loop (same one that adds the `.temporal-badge`) for the static Suite Grid, and via the `idx.tags` check in the Command Console's dynamic button template. Badges are NOT `pointer-events: none` (unlike `.temporal-badge`) so each can show its own `[data-tooltip]` text independently, using the existing capture-phase `mouseenter`/`closest('[data-tooltip]')` JS tooltip handler in `index.html`.

**Scope boundary:** Only the main Suite Grid and Command Console surfaces got badges. `triage-tag-pill` (Focused Triage) and `evidence-lens-btn` (evidence timeline) were left untouched — those are compact pill/lens buttons where a third badge would be visually cramped, and the user's request was framed around "which to poke," which those two secondary surfaces aren't the primary answer to.

**Verification:** `node --check` on `src/app.js`/`src/indices.js`; full existing test suite still passes (`test.js`, `test_core_ui_contract.mjs`, `test_core_formula_parity.mjs`, `test_scientific_status.mjs`, `test_spill_evidence_timeline.mjs`, `test_share_sentinel_only.mjs`, `test_date_selector_filter.mjs`); manually verified in headless Chrome that exactly the 13 intended index keys render the correct badge combination in both the Suite Grid and Command Console, with zero page errors.

---

## Date selectors filter to Sentinel-only dates in both apps (2026-07-23)

**Decision:** In Limn (`date-single`/`date-t1`/`date-t2`) and Limn Atlas (`date-input`), only dates with a real Sentinel-1 GRD or Sentinel-2 L2A scene (per CDSE STAC catalog for the current AOI) remain as selectable options, each tagged `' [S]'`. Landsat presence alone does not count. Invalid dates are removed outright, not shown disabled.

**Locked scope (confirmed with user):** Sentinel-only (not Landsat); full removal not disable; Atlas's native `<input type="date">` replaced with a grouped `<select>` (native date inputs can't tag/filter arbitrary days); full STAC pagination + client-side caching in scope (no bounded-recent-window shortcut).

**Why:** User request — Sentinel imagery in the date selector should be marked, and dates without any Sentinel collection shouldn't be offered at all.

**Key discovery mid-implementation:** `app.js`'s `probeAcquisitions()` wrapper had `if (isGeeProviderActive()) return;`, which skipped catalog probing (and therefore ALL tagging, including the pre-existing cosmetic `[S]/[L]/[F]` tags) whenever the provider wasn't `sentinelhub` — i.e. always, under the real default (`cog`). This matched `api-contracts.md`'s documented claim that GEE mode skips acquisition probing, but meant the feature was fully dead in normal usage. Removed the gate since catalog lookups only need CDSE OAuth credentials, independent of tile-serving provider.

**Implementation:** New shared `src/sentinel-catalog.js` (`fetchValidSentinelDates`) used by both `report.js` (Limn) and `atlas-app.js` (Atlas); paginates the SH Catalog/STAC API and caches per bbox+date-range client-side. `populateGroupedDates()` in `app.js` was hoisted out of its `DOMContentLoaded` closure so it can be re-invoked by `window.rebuildDateSelectors()` once the probe resolves. `date-single`'s option values still resolve via the global `ALL_DATES.indexOf()`, not the filtered subset, preserving the pre-existing index-based value contract (see `[[architecture.md]]`). Spill-bookmark jump (`setClosestDateValue`) and the FIS trend-chart click handler now snap to the nearest *valid* date via a shared `closestDateIndex()` helper instead of risking a blank/nonexistent `<select>` value. Fail-open: before the first probe resolves (or on CDSE auth failure), both apps show a usable date list rather than an empty one.

**Open/unverified:** SH Catalog API pagination is implemented against an assumed cursor shape (`next` token) with a STAC `links[rel=next]` fallback — not exercised against a live CDSE token this session (no credentials configured in this environment). Worth a real-account smoke test before trusting deep pagination beyond one page.

**Verification:** `tests/test_date_selector_filter.mjs` (new) — puppeteer smoke test for both apps confirming the trial/mock-mode fallback actually filters (not just tags) each selector. All prior test suites (`test.js`, `test_fetch.js`, `test_pwi.js`, `test_core_ui_contract.mjs`, `test_core_formula_parity.mjs`, `test_scientific_status.mjs`, `test_spill_evidence_timeline.mjs`, `test_atlas_formula_v2.mjs`, `test_atlas_capability_families.mjs`, `test_atlas_gee_smoke.mjs`, `test_share_sentinel_only.mjs`) still pass. Manually verified in a real headless-Chrome session that clicking a spill bookmark lands `date-single` on a valid, `[S]`-tagged, non-blank option.

---

## Core Limn uses an evidence-first investigation stack (2026-07-21)

**Decision:** True Color is the default lens. The primary stack is True Color, LBI, MNDWI, AWEIsh, NDMI, SAVI, BSI, dual-SWIR contrast, B12/B11/B04 SWIR false color, and NDRE. PWCI, ASAI, and OBEC remain executable in a collapsed **negative-result study** drawer, and the remaining custom composites remain in a collapsed research library.

**Reason:** The July controls do not support presenting PWCI, ASAI, or OBEC as primary detectors. A context-first workflow better supports falsification: verify the surface and pixel quality, compare dates, examine water/moisture/soil/vegetation responses, and only then inspect experimental composites.

**Quality contract:** Primary Sentinel-2 paths use SCL classes 4–7 as the renderable allow-list. COG and GEE now implement the same primary lenses and the current PWCI/ASAI/OBEC/LBI formulas, including the LBI standing-water bypass. Before/after swipe is available in COG; mathematical COG Diff/Cumulative remains disabled. Sentinel-1 is labeled surface context, not a produced-water or orbit-matched change detector.

**Provider exception:** The bundled optional Sentinel Hub `AGRICULTURE` WMS carrier is Sentinel-2 L1C and cannot accept the L2A-only SCL band. Limn removes the marked SCL gate only for that WMS configuration and visibly reports `WMS: no SCL band`; L2A COG/GEE retain pixel QA. `SENTINEL_WMS_SUPPORTS_SCL` may be enabled only for a verified L2A WMS carrier.

**Scientific boundary:** AWEIsh and NDRE are established contextual formulas. SWIR false color is a visualization. Adding them improves interpretation and failure-mode awareness but does not improve the measured produced-water accuracy of the experimental composites. Correlated agreement does not count as independent confirmation.

**Product separation:** This change is confined to original Limn. It does not add produced-water content, formulas, controls, or claims to Limn Atlas, its 91-method catalog, or the Atlas preprint.

**Verification:** Core formula parity, UI contract, GEE/COG route tests, bookmark QC, syntax checks, and browser smoke checks are the release gate.

---

## Core Limn analytics now match rendered formulas and use surface-response names (2026-07-21)

**Decision:** Keep the historical internal keys for compatibility, but rename broad-band chemical-sounding layers and composites by what their formulas actually measure. `ndwi` is displayed as Xu MNDWI; NDSI/HCAI/HMRI/NDOI legacy keys are dual-SWIR, SWIR1–Red, SWIR2/Green, and Blue–SWIR2 surface contrasts. PWCI, OBEC, FBC, REAI, VCBI, TRI, BPI, VSI, CMA, PHI, HMI, EHC, SCRI, and MVPI now state explicit non-retrieval and non-validation boundaries.

**Formula parity:** `fisLogic` now returns the same sensitivity thresholds, nonlinear scaling, blanking gates, and displayed score used by each corresponding evalscript. The parity set covers ASAI, OBEC, FBC, REAI, VCBI, PWCI, LBI, TRI, BPI, VSI, CMA, PHI, HMI, MVPI, EHC, SCRI, and Sentinel-1 VV context. These values are display/screening scores, not probabilities.

**UI boundary:** AOI scan and report actions are enabled only for the guarded Sentinel Hub provider because the COG/GEE route does not implement equivalent analytics. Investigate search still exposes unavailable layers as disabled results so capability discovery does not silently change by provider. Report generation has one authoritative event path.

**Evidence boundary:** LBI's 2/4 standing-brine versus 0/3 freshwater result remains preliminary (two-sided Fisher exact p≈0.43), not brine specificity. PWCI/ASAI/OBEC remain negative-result screening architectures. MVPI is a legacy single-scene SWIR ratio screen, not methane retrieval.

**Separation:** This decision applies only to original Limn's produced-water investigation surfaces. No Atlas formula, catalog, preprint inventory, or 91-index artifact is changed by this reconciliation.

**Verification:** `tests/test_core_formula_parity.mjs`, `tests/test_core_ui_contract.mjs`, the science-status test, bookmark QC, syntax checks, and browser interaction checks form the release gate.

---

## Atlas is organized by capability family, not index count (2026-07-20)

**Decision:** Preserve all 91 Atlas records while organizing them into 24 capability families. Each record now carries a method role: 15 `primary`, 10 `variant`, 12 `component`, 1 `reference`, 51 `research-model`, and 2 `retired`. Family membership describes a shared physical question or decision; it does not establish scientific equivalence, novelty, or validation.

**Application boundary:** Limn Atlas defaults to family-first navigation, retains the 12-domain view as a secondary lens, and moves research models and retired formulas into a dedicated Research view. Core Limn's produced-water screen is unchanged because its negative-result evaluation is a separate evidence set. The produced-water preprint receives only a scope clarification for the four shared ecological examples.

**Editorial boundary:** The six G&A leads—BH-DFSI, LFMPI, PETI, EPDI, EC-ACI, and TDR-ASI—are primary methods inside six capability families. Article language must identify the family and method role and must not imply that a named method is an independently validated invention. Sibling variants can be used for comparison, not multiplied into additional novelty claims.

**Verification:** `tests/test_atlas_capability_families.mjs` requires complete family membership, stable role counts, no orphaned families, research/retired methods to remain non-live, and family/domain/research navigation to remain present.

---

## Core Limn and Atlas public science now use formula-fidelity status metadata (2026-07-20)

**Decision:** Keep the executable PWCI, ASAI, OBEC, and LBI math unchanged while revising their public names, formulas, and evidence labels to match the shipped evalscripts and July controls. The core app now shows formula and validation status in its legend and reports. LBI is now **Liquid/Salinity Response Index** because the preliminary standing-water sample overlaps freshwater controls.

**Atlas synchronization:** Atlas retains 37 live M3 screening proxies. Nested bookmark reconciliation is now explicit, TFIDI uses `2021-08-17`, and IPVSI uses `2021-09-01`, the strongest tested representative scenes. The current WMS audit is 35 `strong`, 2 `moderate` (RRFI and MP-PDI), and 0 weak/blank/error. Moderate dates remain event-aligned because brighter nearby dates did not materially improve the article truthfulness.

**G&A article leads:** BH-DFSI, LFMPI, PETI, EPDI, EC-ACI, and TDR-ASI are the current six lead candidates. Each stores its bookmark-date role, exact CDSE acquisition timestamp, cloud cover, article angle, and QC status. SF-EII was removed because its physical claim was retired; RRFI was removed from the lead set because its overlay remains moderate.

**Verification:** Core bookmark metadata is 13 pass / 0 warn / 0 fail. Atlas is 35 strong / 2 moderate. The evidence audit is 42/42 Gold-ready across the 37 live Atlas formulas plus five SAR/S5P demo layers. A six-target capture audit resolved 24 WMS images with CDSE acquisition metadata. Formula, browser, and catalog tests are the release gate.

**Claim boundary:** A visually strong bookmark means that the shipped screening proxy is legible at a cited event context. It does not validate the formula, map an official event perimeter, or establish causal attribution.

---

## Atlas v2 separates formulas, implementation, contribution, and validation (2026-07-20)

**Decision:** Treat the Atlas as 91 proposed remote-sensing specifications, not 91 novel or validated indices. Every entry now exposes an explicit formula version, proposed and implemented formulas, implementation maturity (M1–M3), contribution class (C1–C3), required inputs, operators, units, calibration state, and validation state.

**Scientific corrections:** Reconciled the public descriptions of all 23 live formulas that differed from their evalscripts; replaced LFMPI's pseudo-LFMC expression with a normalized NDMI-deficit screening proxy; corrected priority definitions including SACI, RDOCI, PWTDI, REENBI, TSEAI, NFCAI, and PUENPI; and reframed formulas that require temporal analysis, spatial operators, radiative transfer, inversion, or field calibration as research workflows rather than arithmetic indices. SF-EII and AMDPHI are no longer live because their existing evalscripts did not implement the claimed physical quantities.

**Resulting inventory:** 37 live screening proxies (M3), 16 executable non-live formulas (M2), and 38 specified concepts or retired formulas (M1). All entries remain below V1 independent evaluation. Bookmarks and citations provide inspectable event context, not accuracy evidence.

**Why:** The July 2026 audit found formula-to-code mismatches, unsupported dimensional operations, missing temporal/spatial operators, and sensor-resolution limits. A single novelty tier had also conflated originality, implementation, evidence, and validation.

**Verification:** `npm run test:atlas:formula`, focused LFMPI and SMPDI tests, JavaScript syntax checks, and `execution/audit_atlas_evalscripts.py` all pass; the audit covers all 37 renderable evalscripts.

---

## Preprint claims reconciled to pipeline-vs-viewer reality (2026-07-19)

**Decision:** Public docs (PUBLIC_SCIENCE_GUIDE.md, README.md, SENTINEL_SCIENCE_GUIDE.md, help.html) now explicitly distinguish two calibrations and state the detection numbers as recall-only.

- **Validated pipeline calibration** (`execution/batch_analyze_spills.py`): PWCI τ=0.03/0.05/1.1 with ×5/×3 gains and pow(raw×50,1.2)×soft-BSI stretch; ASAI/OBEC dry gate NDWI<−0.30 ∧ NDSI>0.05 ∧ BSI>0.10. This is the source of PWCI 81.5% / ASAI 77.8% / OBEC 66.7% (2026-03-28, n=27).
- **Interactive viewer calibration** (`src/indices.js` + Permian preset): PWCI τ=0.10/0.30/2.0 with ×2/×2 gains, hard BSI mask, cubic (raw×20)³ stretch; ASAI dry gate hardened 2026-06-07/08 to NDSI>0.15, BSI>0.52, smoothness<−0.42, 0.60 floor. Precision-first; renders blank at many pipeline-detected sites.

**Why:** QC (`reports/preprint_qc_2026-07-19.md`) found the May-2026 preprint published a PWCI formula that was a splice of both (never benchmarked as written), unsupported false-positive numbers (42.3%/0.04% — no negative-sampling run exists), an untraceable "27 TRRC-verified" dataset (`data/rrc_spills.json` self-describes as a curated snapshot with generalized coordinates), and §5 eco formulas matching no code version. Removing/qualifying these protects the publication's credibility.

**Follow-ups:** (1) ~~run a background/false-positive study~~ and (2) ~~measure viewer-calibration FP~~ **BOTH DONE 2026-07-19.** Scripts: `execution/sample_background.py` (150 Permian background points, raw bands persisted), `summarize_false_positives.py` (pipeline), `score_viewer_calibration.py` (faithful port of shipped src/indices.js evalscripts, Permian preset).

**KEY FINDING — neither shipped calibration discriminates:**
- Pipeline calibration: recall PWCI 81.5% / ASAI 77.8% / OBEC 66.7%, but FP PWCI **96.7%** / ASAI **71.3%** / OBEC **71.3%** (median PWCI background score = 1.000). Fires almost everywhere.
- Viewer calibration: FP **0.0%** on all three (max rendered PWCI across 150 pts = 0.00000), but renders blank at all 11 verified spill sites too. Fires almost nowhere. Mechanism: strict triple-gate (HMRI>2.0) + cubic stretch + 0.05 blank gate crush everything; only 10/150 points even clear the raw gate and none survive the stretch.
- Conclusion: Limn's flagship composites do not yet achieve useful recall AND low FP in any shipped config. Whitepaper §7/§8 repositioned to "experimental screening methodology, not validated detector."

**Threshold sweep DONE 2026-07-20** (`execution/sweep_thresholds.py`, `reports/threshold_sweep_2026-07-20.md`) — fetched raw bands for all 32 TRRC records (`fetch_spill_bands.py` → `spill_bands.csv`), swept PWCI's 3 internal gates (1,224 combos) + per-index ROC frontier at fixed thresholds.

**VERDICT — no discriminating calibration exists:** PWCI best operating point ~19% recall / ~9% FP, continuous-score Youden's J ≈ 0.00 (the 81.5% "recall" was firing on 97% of background). Best of any composite = ASAI ~53% recall / ~30% FP. The "middle calibration probably exists" hypothesis is refuted: these S2 bands at 500 m single-scene scale do not separate produced water from Permian caliche at any threshold. Bounded negative result (leaves higher-res/temporal/SAR/hyperspectral open).

**CORRECTION:** earlier "LBI 63% recall at 1.3% FP" was a threshold-mismatch error (recall at t=0.01 where FP=86%, paired with FP at t=0.08 where recall=9%). At fixed thresholds LBI peaks ~22%/20%. `summarize_false_positives.py` now warns against pairing its columns. This also withdrew earlier option (c) "reframe around indices that work" — none discriminate well.

**Recommendation to author = (a):** publish as an honest, earned negative-result / methodology paper (scope claim to S2/500 m/single-scene; multi-gate architecture + verified-site program + rigorous spectral-limit demonstration are the contribution). Still open: attach real RRC incident IDs; explore a different sensing modality if a detector is wanted.

**Author positioning decision (surfaced, not mine to make):** publish as honest work-in-progress/negative-result methodology (a); hold distribution until a discriminating calibration exists (b); or reframe around the indices/verified-site program that do work (c). See QC report "Author decision needed".

---

## Canonical remote is globe-and-atlas/limn (2026-07-19)

**Decision:** `public` (<https://github.com/globe-and-atlas/limn>) is the legit/canonical remote; `origin` (dbally-gis/limn) is legacy. Local `main` now tracks `public/main`, so plain `git push` / `git pull` go to globe-and-atlas.

**Why:** Owner confirmed globe-and-atlas/limn is the authoritative copy; origin had drifted and is no longer the publication home.

**How applied:** `git branch -u public/main` set on 2026-07-19. Push to `origin` only if explicitly asked.

---

## Atlas LinkedIn guidance stays inside the info panel (2026-06-23)

**Decision:** Add LinkedIn-caliber Ground Truth guidance as a selected-index info-panel section instead of creating a new Atlas category or navigation lane.

**Why:** The useful editorial habit is not taxonomy; it is making each renderable index explain one image, one observation, one reason it matters, and one open question. Keeping it inside the selected-index panel makes Atlas teach the posting format without changing the scientific catalog.

**How applied:** `atlas.html` exposes the LinkedIn Ground Truth card, and `src/atlas-app.js` derives the visual anchor, observation, interpretation, question, and copyable draft from existing index metadata.

---

## Atlas WMS source switch stays session-scoped (2026-06-16)

**Decision:** Let Limn Atlas switch between the configured Copernicus WMS endpoint and the Sentinel Viewer WMS endpoint at runtime through the Atlas HUD.

**Why:** The configured account can run out of credits while the viewer endpoint still has usable quota. Editing `config-v1.js` during a live Atlas session is too slow and too easy to get wrong.

**How applied:** `src/atlas-app.js` resolves `configured` and `viewer` WMS sources separately. The source selector changes only the active WMS endpoint; it does not arm Sentinel live tiles or bypass the minimum zoom guard.

---

## S2-only proxy for APEX/HPWI indices

**Decision:** Use Sentinel-2 only evalscripts for APEX and HPWI indices rather than multi-datasource S1+S2 fusion.

**Why:** Sentinel Hub WMS rejects multi-datasource evalscripts (S1+S2) with a 400 error when requesting APEX/HPWI. S2-only proxies produce equivalent detection quality for these indices.

**How applied:** `known-quirks.md` documents this. Evalscript selection logic checks index type before choosing fusion vs S2-only.

---

## Deep Fusion removed (2026-05-23)

**Decision:** Removed the "Radar Confirmation (OBEC & ASAI)" deep fusion checkbox and all associated state/handler code.

**Why:** `deepEvalscript` was never defined on any index in `indices.js`. The `state.deepFusion && cfg.deepEvalscript` branch in `map.js` was always a no-op. The checkbox appeared functional but had zero effect on rendered tiles. Also cleaned up stale `hpwi` key references in `map.js` that survived the HPWI→OBEC/pwoi rename.

**Files changed:** `index.html` (removed checkbox), `src/app.js` (removed state + handler), `src/map.js` (removed dead branch + stale `hpwi` conditions).

---

## Dry brine mode as parallel formula path (not replacement)

**Decision:** Add a dry-brine detection path to APEX and HPWI as a `max(wet, dry)` complement, not a conditional branch that replaces the wet formula.

**Why:** Replacing the wet formula would break detection for standing water bodies (e.g. Lake Boehmer, 60-acre saltwater lake — APEX 0.843 wet mode). A `max()` over both paths preserves all existing detections while recovering dry/evaporated sites. Triggered only when all three dry conditions hold (NDWI < −0.30, NDSI > 0.05, BSI > 0.10) to minimize false positives.

**Validation delta (2026-03-28):** APEX 29.6% → 77.8% (+48 pp), HPWI 14.8% → 66.7% (+52 pp).

**Open risk:** Dry-mode NDSI > 0.05 gate may fire on natural high-NDSI caliche. False positive rate on non-spill control sites not yet measured. Do not trust dry-mode scores in isolation without PWI cross-confirmation.

---

## Soft BSI weight for PWI (floor at 0.3)

**Decision:** Replace the hard BSI gate (`if bsi <= 0.01 return 0`) with a soft weight `bsi_weight = clamp(bsi × 5.0 + 0.3, 0.3, 1.0)`.

**Why:** TRRC spill records use parcel centroid coordinates, not the exact spill GPS. A 500m bbox around a centroid frequently captures mixed caliche + vegetation pixels, depressing BSI near zero even at confirmed spill sites. The hard gate produced 0% PWI detection on the 2026-03-08 validation run.

**How applied:** `pwi = pow(pwi_base × 50.0, 1.2) × bsi_weight`. Floor of 0.3 ensures a centroid mis-hit doesn't zero the full score; sites with strong spill chemistry still reach 1.0 via the cubic scaling.
