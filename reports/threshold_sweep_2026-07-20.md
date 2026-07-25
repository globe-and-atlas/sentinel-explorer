# Limn Threshold Sweep — Does a Discriminating Calibration Exist?

Spill sites: 32 (all TRRC records in data/rrc_spills.json). Background: 150 (Permian, no event).

## Verdict

- **PWCI does NOT discriminate at any threshold:** its best recall−FP operating point is only 19% recall / 9% FP. The three chosen bands do not separate produced water from Permian caliche; no re-tuning of these gates fixes it.
- **Indices that do not** at that bar: PWCI, ASAI, OBEC, LBI, VSI, BPI.

## Scope & caveats (read before quoting these numbers)

- **Recall and FP must be read at the SAME threshold.** Pairing a recall measured at one threshold with an FP measured at another is meaningless and inflates apparent performance. (Example of the trap: LBI shows 62% recall at t=0.01 but 86% FP there; 1.3% FP only arrives at t=0.08, where recall is 9%. 'LBI = 63% recall at 1.3% FP' pairs two different operating points and is false.) Every cell in this report holds the threshold fixed.
- **Why the pipeline still 'scored' 81.5%:** at t=0.01 PWCI fires on 97% of background too — the high recall is an artifact of firing nearly everywhere, not discrimination. PWCI's continuous score is effectively saturated/binary (Youden's J = 0.00).
- **Scope of the negative result:** this concerns these specific Sentinel-2 spectral composites at a 500 m box / single-scene Statistics-API mean, over a 27→32-record TRRC development benchmark and 150 background points. It does not, by itself, rule out higher-resolution, multi-temporal, SAR, or hyperspectral approaches, nor the multi-gate *concept* in general — only that these bands at this scale do not separate produced water from Permian caliche at any threshold.
- Spill n=32 here (all TRRC records fetched cleanly) vs 27 in the 2026-03-28 run; band means are event-date ±15-day Statistics API composites.

## PWCI 3-gate threshold sweep (multi-gate AND, the flagship test)

Grid: NDSI x HCAI x HMRI = 8x9x17 = 1224 combos. Recall on 32 spills, FP on 150 background.
Ships today: NDSI/HCAI/HMRI = 0.03/0.05/1.1 (pipeline) and 0.10/0.30/2.0 (viewer).

**Best recall achievable under each false-positive ceiling:**

| FP ceiling | Max recall | at (NDSI, HCAI, HMRI) | FP there |
|---|---|---|---|
| ≤2% | **6.2%** | (0.08, 0, 2.5) | 1.3% |
| ≤5% | **12.5%** | (0.08, 0, 2.2) | 4.7% |
| ≤10% | **18.8%** | (0.06, 0, 2.3) | 10.0% |
| ≤20% | **28.1%** | (0.08, 0, 0.9) | 20.0% |
| ≤30% | **28.1%** | (0, 0, 2.3) | 23.3% |

**Best separation (max recall−FP):** recall 18.8% at FP 9.3% (J=0.09), thresholds NDSI/HCAI/HMRI = 0.06/0.3/2.3.

## Per-index ROC frontier (continuous pipeline score, single threshold)

For each index: best spill recall achievable while holding background FP under a ceiling, plus Youden's J (max recall−FP) and the AUC-like separation. A working detector shows high recall at low FP; a non-discriminating one tracks the diagonal.

| Index | Recall@FP≤5% | Recall@FP≤10% | Recall@FP≤20% | Best J (recall/FP) |
|---|---|---|---|---|
| PWCI | 0.0% | 0.0% | 0.0% | J=0.00 (0%/0%) |
| ASAI | 9.4% | 21.9% | 34.4% | J=0.23 (53%/30%) |
| OBEC | 12.5% | 25.0% | 31.2% | J=0.16 (47%/31%) |
| LBI | 12.5% | 15.6% | 21.9% | J=0.10 (16%/5%) |
| VSI | 6.2% | 6.2% | 18.8% | J=0.04 (6%/2%) |
| BPI | 3.1% | 6.2% | 12.5% | J=0.01 (6%/5%) |

