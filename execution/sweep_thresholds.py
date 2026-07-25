"""Recall-vs-false-positive threshold sweep for Limn produced-water composites.

Answers the load-bearing question the two fixed calibrations could not: does *any*
threshold configuration make a composite discriminate — high spill recall AND low
background false-positive rate — or is the recall-FP tradeoff essentially the
diagonal (no separation) for the flagships?

Inputs (raw Sentinel-2 band means, self-sufficient):
  execution/spill_bands.csv       — 32-record TRRC benchmark, event dates
                                    (all 32 records in data/rrc_spills.json; the earlier
                                     2026-03-28 index run in validation_raw.csv covered
                                     only 27 of them, which is the source of the 27/32
                                     discrepancy in older summaries)
  execution/background_raw.csv    — 150 Permian background points

Two analyses:
  1. PWCI 3-gate grid: sweep the three internal thresholds (NDSI, HCAI, HMRI) of
     the multi-gate AND directly; detection = all three gates pass. Traces the full
     recall/FP surface and its Pareto frontier — the definitive test of the flagship.
  2. Per-index ROC frontier: compute each composite's continuous pipeline score on
     both sets, sweep a single detection threshold, and report the best operating
     points (recall at FP<=5/10/20%) and Youden's J (max recall-FP). Uniform,
     separability-focused view across indices.

Usage:
    python3 execution/sweep_thresholds.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from batch_analyze_spills import calculate_indices  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
BANDS = ["B02", "B03", "B04", "B05", "B07", "B08", "B8A", "B11", "B12"]


def load(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = [b for b in BANDS if b not in df.columns]
    if missing:
        raise SystemExit(f"{path.name} missing bands {missing}")
    return df


def pwci_gate_sweep(spills: pd.DataFrame, bg: pd.DataFrame) -> list[str]:
    """Sweep PWCI's three internal AND-gate thresholds; report recall/FP frontier."""
    def gates(df):
        brine = (df.B11 - df.B12) / (df.B11 + df.B12)
        hcai = (df.B11 - df.B04) / (df.B11 + df.B04)
        hmri = df.B12 / df.B03
        return brine.values, hcai.values, hmri.values

    sb, sh, sm = gates(spills)
    bb, bh, bm = gates(bg)
    ns, nb = len(spills), len(bg)

    t1_grid = np.round(np.arange(0.00, 0.151, 0.02), 3)   # NDSI
    t2_grid = np.round(np.arange(0.00, 0.401, 0.05), 3)   # HCAI
    t3_grid = np.round(np.arange(0.90, 2.51, 0.10), 2)    # HMRI

    combos = []
    for t1 in t1_grid:
        for t2 in t2_grid:
            for t3 in t3_grid:
                recall = np.mean((sb > t1) & (sh > t2) & (sm > t3))
                fp = np.mean((bb > t1) & (bh > t2) & (bm > t3))
                combos.append((t1, t2, t3, recall, fp))
    cdf = pd.DataFrame(combos, columns=["t1", "t2", "t3", "recall", "fp"])

    out = ["## PWCI 3-gate threshold sweep (multi-gate AND, the flagship test)", "",
           f"Grid: NDSI x HCAI x HMRI = {len(t1_grid)}x{len(t2_grid)}x{len(t3_grid)} "
           f"= {len(cdf)} combos. Recall on {ns} spills, FP on {nb} background.",
           f"Ships today: NDSI/HCAI/HMRI = 0.03/0.05/1.1 (pipeline) and 0.10/0.30/2.0 (viewer).", ""]

    # Best recall achievable under each FP ceiling.
    out.append("**Best recall achievable under each false-positive ceiling:**")
    out.append("")
    out.append("| FP ceiling | Max recall | at (NDSI, HCAI, HMRI) | FP there |")
    out.append("|---|---|---|---|")
    for ceil in (0.02, 0.05, 0.10, 0.20, 0.30):
        sub = cdf[cdf.fp <= ceil]
        if sub.empty:
            out.append(f"| ≤{ceil*100:.0f}% | — | — | — |")
            continue
        best = sub.loc[sub.recall.idxmax()]
        out.append(f"| ≤{ceil*100:.0f}% | **{best.recall*100:.1f}%** | "
                   f"({best.t1:g}, {best.t2:g}, {best.t3:g}) | {best.fp*100:.1f}% |")
    out.append("")

    # Best separation overall (Youden's J = recall - fp).
    cdf["J"] = cdf.recall - cdf.fp
    bestJ = cdf.loc[cdf.J.idxmax()]
    out.append(f"**Best separation (max recall−FP):** recall {bestJ.recall*100:.1f}% at "
               f"FP {bestJ.fp*100:.1f}% (J={bestJ.J:.2f}), "
               f"thresholds NDSI/HCAI/HMRI = {bestJ.t1:g}/{bestJ.t2:g}/{bestJ.t3:g}.")
    out.append("")
    return out, float(bestJ.recall), float(bestJ.fp)


def roc_frontier(spills: pd.DataFrame, bg: pd.DataFrame) -> list[str]:
    """Per-index continuous-score sweep of a single detection threshold."""
    def score_frame(df):
        recs = []
        for _, r in df.iterrows():
            recs.append(calculate_indices({b: float(r[b]) for b in BANDS}))
        return pd.DataFrame(recs)

    s_idx = score_frame(spills)
    b_idx = score_frame(bg)

    indices = [("PWI", "PWCI"), ("APEX", "ASAI"), ("HPWI", "OBEC"),
               ("LBI", "LBI"), ("VSI", "VSI"), ("BPI", "BPI")]
    thresholds = np.round(np.arange(0.0, 1.001, 0.005), 3)

    out = ["## Per-index ROC frontier (continuous pipeline score, single threshold)", "",
           "For each index: best spill recall achievable while holding background FP under a "
           "ceiling, plus Youden's J (max recall−FP) and the AUC-like separation. A working "
           "detector shows high recall at low FP; a non-discriminating one tracks the diagonal.", "",
           "| Index | Recall@FP≤5% | Recall@FP≤10% | Recall@FP≤20% | Best J (recall/FP) |",
           "|---|---|---|---|---|"]
    verdicts = {}
    for key, name in indices:
        if key not in s_idx.columns:
            continue
        ss = s_idx[key].values
        bs = b_idx[key].values
        row = {}
        for ceil in (0.05, 0.10, 0.20):
            best_r = 0.0
            for t in thresholds:
                fp = np.mean(bs > t)
                if fp <= ceil:
                    best_r = max(best_r, np.mean(ss > t))
            row[ceil] = best_r
        # Youden's J
        bestJ, bestJ_t = -1.0, 0.0
        for t in thresholds:
            j = np.mean(ss > t) - np.mean(bs > t)
            if j > bestJ:
                bestJ, bestJ_t = j, t
        rec_at = np.mean(ss > bestJ_t)
        fp_at = np.mean(bs > bestJ_t)
        verdicts[name] = (row[0.10], bestJ)
        out.append(f"| {name} | {row[0.05]*100:.1f}% | {row[0.10]*100:.1f}% | "
                   f"{row[0.20]*100:.1f}% | J={bestJ:.2f} ({rec_at*100:.0f}%/{fp_at*100:.0f}%) |")
    out.append("")
    return out, verdicts


def main() -> None:
    spills = load(REPO / "execution" / "spill_bands.csv")
    bg = load(REPO / "execution" / "background_raw.csv")

    header = ["# Limn Threshold Sweep — Does a Discriminating Calibration Exist?", "",
              f"Spill sites: {len(spills)} (all TRRC records in data/rrc_spills.json). "
              f"Background: {len(bg)} (Permian, no event).", ""]

    pwci_lines, pwci_best_r, pwci_best_fp = pwci_gate_sweep(spills, bg)
    roc_lines, verdicts = roc_frontier(spills, bg)

    # Overall verdict.
    verdict = ["## Verdict", ""]
    good = [n for n, (r10, j) in verdicts.items() if r10 >= 0.50 and j >= 0.45]
    weak = [n for n, (r10, j) in verdicts.items() if n not in good]
    if pwci_best_r >= 0.50 and pwci_best_fp <= 0.10:
        verdict.append(f"- **PWCI CAN discriminate:** a threshold set reaches "
                       f"{pwci_best_r*100:.0f}% recall at {pwci_best_fp*100:.0f}% FP — better than "
                       "either shipped calibration. The flagship is salvageable with re-tuning.")
    else:
        verdict.append(f"- **PWCI does NOT discriminate at any threshold:** its best recall−FP "
                       f"operating point is only {pwci_best_r*100:.0f}% recall / {pwci_best_fp*100:.0f}% FP. "
                       "The three chosen bands do not separate produced water from Permian caliche; "
                       "no re-tuning of these gates fixes it.")
    if good:
        verdict.append(f"- **Indices that DO discriminate** (≥50% recall at ≤10% FP, J≥0.45): "
                       f"{', '.join(good)}.")
    if weak:
        verdict.append(f"- **Indices that do not** at that bar: {', '.join(weak)}.")
    verdict.append("")

    caveats = [
        "## Scope & caveats (read before quoting these numbers)", "",
        "- **Recall and FP must be read at the SAME threshold.** Pairing a recall measured at "
        "one threshold with an FP measured at another is meaningless and inflates apparent "
        "performance. (Example of the trap: LBI shows 62% recall at t=0.01 but 86% FP there; "
        "1.3% FP only arrives at t=0.08, where recall is 9%. 'LBI = 63% recall at 1.3% FP' "
        "pairs two different operating points and is false.) Every cell in this report holds "
        "the threshold fixed.",
        "- **Why the pipeline still 'scored' 81.5%:** at t=0.01 PWCI fires on 97% of background "
        "too — the high recall is an artifact of firing nearly everywhere, not discrimination. "
        "PWCI's continuous score is effectively saturated/binary (Youden's J = 0.00).",
        "- **Scope of the negative result:** this concerns these specific Sentinel-2 spectral "
        "composites at a 500 m box / single-scene Statistics-API mean, over a 27→32-record TRRC "
        "development benchmark and 150 background points. It does not, by itself, rule out "
        "higher-resolution, multi-temporal, SAR, or hyperspectral approaches, nor the multi-gate "
        "*concept* in general — only that these bands at this scale do not separate produced "
        "water from Permian caliche at any threshold.",
        "- Spill n=32 here (all TRRC records fetched cleanly) vs 27 in the 2026-03-28 run; "
        "band means are event-date ±15-day Statistics API composites.", "",
    ]
    text = "\n".join(header + verdict + caveats + pwci_lines + roc_lines)
    out_path = REPO / "reports" / "threshold_sweep_2026-07-20.md"
    out_path.write_text(text + "\n")
    print(text)
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
