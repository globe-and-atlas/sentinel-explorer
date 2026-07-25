---
generated_by: "Claude Code CLI (Claude Opus 5)"
timestamp: "2026-07-25T12:27:52-05:00"
---

# Preprint alignment — GSIA v2 and the live registry

The Atlas registry in `src/atlas-indices.js` is the source of truth for the
deployment. The **published** GSIA preprint v2 (ESS Open Archive, July 2026)
describes a frozen snapshot: commit `e50c2eda5cf405c7693e5210e04894c691e5f2eb`,
audited 2026-07-21. The two are allowed to diverge — the paper says counts are
"properties of that versioned snapshot" — but the divergence must be *known*.

## Detecting drift

```bash
python3 execution/reconcile_preprint_supplement.py            # report
python3 execution/reconcile_preprint_supplement.py --strict   # exit 1 on any drift
```

Writes `.tmp/preprint_supplement_reconciliation.md`. It checks per-record fields
**and** re-derives the counts the paper asserts, so a structural regression is
caught even if no individual field looks wrong.

## What must never drift without a paper correction

These are load-bearing claims in the abstract and Tables 1–3:

- 91 records, 24 capability families, 12 domains
- maturity split 37 M3 / 16 M2 / 38 M1
- method roles 15 primary / 10 variant / 12 component / 1 reference / 51 research-model / 2 retired
- "all 37 renderable evalscripts passed static band and output checks"
  (re-verify with `python3 execution/audit_atlas_evalscripts.py`)

If a change moves any of these, the archive record needs a new version, not an
erratum.

## What may drift freely

Per-record `name`, `implementedFormula`, `proposedFormula`, `requiredInputs`,
`physics`, and `benefit` — provided the change moves *toward* the registry's own
standard (stating what executes, not what is hoped for). Record these in the
erratum instead of regressing the app.

## Current state (2026-07-25)

All load-bearing counts hold. 37 field-level differences, all corrections made
during the 2026-07-25 scientific review. Documented in
`remote-sensing-research/preprint/gsia_preprint_v2_erratum_2026-07-25.md`.

**Drift can point either way.** EC-ACI is stale in the *supplement*, not the app:
it was corrected in the deployment on 2026-07-23, after the snapshot, so the
published row still carries its pre-correction ECOSTRESS claim. Do not "fix" the
app to match the paper — check which side is newer first.
