# Limn Atlas

A browser-based registry and rendering surface for **91 proposed environmental remote-sensing index specifications** across twelve domains, organized into 24 capability families.

Atlas is not a detector catalogue. It is a **hypothesis registry**: every record states what it actually computes, what it cannot establish, how mature the implementation is, and what evidence would be required to promote it. Records that fail, get superseded, or are retired stay visible rather than disappearing.

Atlas is published as a preprint — *The Global Spectral Index Atlas (GSIA)*, [ESS Open Archive](https://essopenarchive.org/doc/007f7377-d063-474f-9ba0-d776c927729e). This app is its live implementation surface.

> **Atlas and Limn Produced Water are deliberately separate.** `atlas.html` covers general Earth science — wildfire, water quality, urban heat, permafrost, agriculture, mining. It contains no produced-water formulas. `index.html` is the Permian Basin produced-water screening tool and is documented in [README.md](README.md). Atlas overlays are inspectable context, not extensions of Limn's produced-water work.

---

## What an Atlas output means

Three statements must be kept distinct, and the interface is built around that separation:

1. **Direct observation** — what the input product and formula actually calculate: a reflectance ratio, a band-index value, a backscatter difference.
2. **Proxy interpretation** — the physical condition hypothesized to influence that calculation: canopy dryness, suspended material, surface change.
3. **Environmental inference** — the target condition a user may want: toxicity, pollutant attribution, structural failure, pH, carbon stock.

Most records connect 1 and 2 through physical reasoning. **The step from 2 to 3 is generally uncalibrated and untested.** A colored overlay is not a concentration map, a causal diagnosis, or a regulatory finding.

Every record carries two paired clauses, surfaced in the info panel as **Observable** and **Intended use & inference limit**.

**No record has completed independent validation.** All 91 read `Not independently evaluated (below V1)`.

---

## What it does

- **Renders 37 live screening proxies** as Sentinel-2 overlays, each with its own evalscript, gradient, and reviewed example location
- **Separates proposed from implemented formulas** — where a record's concept requires terrain, rainfall, time series, or a sensor the live layer does not read, the interface says so instead of implying the full method runs
- **Organizes by capability family**, so algebraic variants, supporting components, and future workflows are not presented as 91 independent inventions
- **Publishes authorship and priority per record** — explicit claims where they exist, and the registry-wide "priority not established" default elsewhere
- **Links each record to reviewed event sources**, with the Sentinel search window distinguished from the event date, and events predating Sentinel-2 marked as unobservable
- **Demonstrates three Sentinel-1 and two Sentinel-5P products** (S1-OWF, S1-URB, S1-VVS, S5P-NO2, S5P-SO2), deliberately excluded from the 91 because they demonstrate sensor access rather than propose a formulation

---

## Registry structure

### Implementation maturity

| Code | State | Count | Meaning |
|---|---|---:|---|
| M3 | Demonstrated | 37 | Renders live; reviewed example with date, location, provenance |
| M2 | Executable | 16 | Entry-specific code runs, but is not exposed as a live layer |
| M1 | Specified / retired | 38 | Documented research object or retired formula; not a live calculation |
| V1 | Independently evaluated | 0 | Requires labels, hard negatives, holdouts, uncertainty, baselines |
| V2 | Externally replicated | 0 | Independent data or team reproduces useful performance |

**M3 does not imply accuracy.** A record can regress if a dependency becomes unavailable.

### Method roles

Each record carries exactly one role, so redundancy is inspectable rather than hidden:

| Role | Count | Meaning |
|---|---:|---|
| Primary | 15 | Clearest current representative of its family — not a validated winner |
| Variant | 10 | Alternate formulation or target interpretation in the same family |
| Component | 12 | Useful context or input; weak as a standalone decision product |
| Reference | 1 | Established sensor product retained for interpretation |
| Research model | 51 | Requires retrieval, calibration, temporal, spatial, or fusion operations not implemented |
| Retired | 2 | Preserved for traceability, removed from live scientific use |

### Contribution class

Neutral descriptors that **do not assert scientific priority**: **C1** proposed formulation (68), **C2** adapted formalization (22), **C3** sensor-enabled implementation concept (1). All carry `Provisional; entry-level prior-art review pending`.

Targeted prior-art review found related earlier work in several domains, so catalogue-wide "first formula" claims are not made.

### Domain coverage

| Domain | Records | Live (M3) |
|---|---:|---:|
| Wildfire & Post-Fire | 7 | 3 |
| Water Quality & Freshwater | 11 | 5 |
| Marine & Coastal | 10 | 6 |
| Agriculture & Food | 7 | 4 |
| Mining & Industrial | 8 | 1 |
| Urban & Infrastructure | 8 | 5 |
| Permafrost & Arctic | 7 | 5 |
| Tropical Forest | 6 | 2 |
| Dryland & Arid | 6 | 1 |
| Wetland & Peatland | 6 | 5 |
| Hyperspectral-Enabled | 8 | 0 |
| Cross-Sensor Fusion | 7 | 0 |
| **Total** | **91** | **37** |

Hyperspectral and fusion domains have no live layers by design — they specify workflows requiring EMIT, EnMAP, PACE, InSAR, or NISAR that a single-scene Sentinel-2 evalscript cannot perform.

---

## Formula schema v2

The distinction that makes the registry honest:

| Field | Meaning |
|---|---|
| `proposedFormula` | The full method, including sensors and operators not yet implemented |
| `implementedFormula` | **Exactly what the evalscript computes**, including gates, coefficients, and thresholds |
| `formulaStatus` | Live screening proxy / Executable but non-live / Not implemented / Rebuild required |
| `requiredInputs` | What the **live** layer needs — not the aspiration |
| `temporalOperator` / `spatialOperator` | Single-scene and per-pixel unless stated |
| `units`, `calibrationStatus`, `validationStatus` | Uncalibrated dimensionless screening score, below V1 |

`FORMULA_V2_OVERRIDES` in `src/atlas-indices.js` carries the corrections. Where a record's name or description once implied more than the code does, the override supplies honest text and the original stays in `legacyFormula` for traceability.

A worked example — DLPEHI advertised an `NDTI > −0.2` term that was never implemented, because NDTI needs B12 and the script never loaded it:

```javascript
dlpehi: {
  name: 'Sparse-Vegetation and Bare-Soil Dryland Context',
  implementedFormula: 'I[0.05<NDVI<0.35] × I[−0.3<NDWI<0.1] × max(0, BSI + 0.1) × 5',
  proposedFormula: 'Oviposition-habitat model combining soil moisture, sparse-vegetation
                    cover, and soil texture with a rainfall gate (e.g. GPM) and validated
                    against ground locust survey records',
  requiredInputs: ['Sentinel-2 L2A'],
}
```

---

## Run

No build step:

```bash
npx serve .          # or: python3 -m http.server 8080
```

Then open `http://localhost:8080/atlas.html`.

### Imagery providers

Atlas defaults to **Google Earth Engine true-color context** until Atlas formulas are ported to the COG renderer. For live index overlays, use the **Sentinel** switch in the top-right toolbar for a guarded Sentinel Hub WMS session.

```bash
cp config.example.js config-v1.js
cp .env.example .env          # fill GEE_PROJECT and service-account path
npm run start:gee
```

Then open `http://127.0.0.1:4177/atlas.html`.

`config-v1.js` and `.env` are gitignored. Never commit service-account JSON, private keys, or tokens.

**Reflectance conventions differ by provider.** Sentinel Hub harmonizes by default; Google Earth Engine's `S2_SR_HARMONIZED` is pre-harmonized; the Earth Search COG archive applies the baseline-04.00 offset to most but not all items and must be resolved per item. See [knowledge/domain/api-contracts.md](knowledge/domain/api-contracts.md) — this is a correctness contract, not a detail.

---

## Bookmarks and evidence

Each record links to reviewed incident or domain sources. Two things are deliberately **not** conflated:

- **`eventDate`** — when the documented incident occurred
- **`date`** — the end of the Sentinel-2 **search window**, never an acquisition timestamp

Of 90 source-reviewed event references, 21 predate Sentinel-2A's launch (2015-06-23) — the earliest by seventeen years. Those carry `date: null` and `sentinelObservable: false`: the site stays inspectable, the event does not. Nine more falling before the dense L2A archive are flagged `sparse`.

An event source establishes that something happened in a place and period. It **cannot** establish pixel labels, causal correspondence, absence of confounders, or detector accuracy. Display QC measures visibility, brightness, and coverage — those are rendering properties, not true-positive rates.

---

## Key files

```
atlas.html                    # Atlas entry point (no build step)
src/
  atlas-indices.js            # 91 records, evalscripts, FORMULA_V2_OVERRIDES, reconcileAtlasIndex()
  atlas-app.js                # Map, info panel, capability navigation, authorship rendering
  atlas-evidence.js           # Evidence packs and citation-counting rules
  atlas-verification.js       # Verification tiers
  atlas-sar-demos.js          # Three Sentinel-1 demonstrations
  atlas-s5p-demos.js          # Two Sentinel-5P demonstrations
  authorshipClaims.js         # Per-record claim / doNotClaim / why
  verifiedBookmarks.js        # Source-reviewed event references
execution/
  audit_atlas_evalscripts.py            # Band-declaration and output-shape audit
  audit_atlas_evidence.py               # Evidence-pack source coverage
  qc_atlas_bookmarks.py                 # WMS pixel QC (--keys for targeted re-runs)
  reconcile_preprint_supplement.py      # Registry vs published supplement
  generate_preprint_supplement.py       # Regenerate the supplement CSV
knowledge/domain/preprint-alignment.md  # What may drift from the paper, and what may not
```

---

## Tests

```bash
npm run test:atlas:formula      # v2 schema, retirement rules, live-formula reconciliation
npm run test:atlas:families     # Family membership, method-role counts, no orphans
npm run test:atlas:gee          # GEE provider smoke test
npm run test:science-status     # Status language does not overclaim
node tests/test_atlas_lfmpi.mjs         # Water rejection and live-vegetation gate
node tests/test_atlas_smpdi.mjs         # Floating-material gates
node tests/test_verified_bookmark_dates.mjs   # No bookmark offers a pre-Sentinel-2 date

python3 execution/audit_atlas_evalscripts.py  # Must report 37 audited, 0 flagged
```

An evalscript that references `sample.Bxx` without declaring it in `setup()` evaluates to **0** in the Sentinel Hub engine — silently corrupting the math and any downstream verdict. The static audit exists to catch exactly that.

---

## Citing

- **Preprint:** *The Global Spectral Index Atlas* — [ESS Open Archive](https://essopenarchive.org/doc/007f7377-d063-474f-9ba0-d776c927729e)
- **Registry source and supplement:** [globe-and-atlas/remote-sensing-research](https://github.com/globe-and-atlas/remote-sensing-research)
- **Audited implementation snapshot:** tag `gsia-v3-audit`

Counts are properties of a versioned snapshot, not permanent properties of the project. Check drift before citing:

```bash
python3 execution/reconcile_preprint_supplement.py
```

---

## Contributing corrections

The registry is designed to be corrected. Useful contributions include: a record whose `implementedFormula` does not match its evalscript; a stated input the code never samples; a physical rationale that misattributes a spectral feature; prior art that should change a contribution class; or a confounder that should be documented.

Corrections are recorded, not quietly applied — see `knowledge/DECISIONS.md` and the preprint erratum. A registry that records its own failures is doing its job.
