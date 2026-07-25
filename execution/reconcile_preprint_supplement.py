#!/usr/bin/env python3
"""Reconcile the live Atlas registry against the published GSIA preprint supplement.

The preprint reports counts and per-record states as properties of a versioned
snapshot (commit e50c2eda, 2026-07-21). The app corrects forward, so drift is
expected and legitimate — but it must be *known* drift, not silent drift. This
script makes every difference explicit so the ESS Open Archive record can be
updated deliberately.

Read-only. Writes a report to .tmp/.

Usage:
  python3 execution/reconcile_preprint_supplement.py
  python3 execution/reconcile_preprint_supplement.py --strict   # exit 1 on drift
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SUPPLEMENT = (
    ROOT.parent
    / "remote-sensing-research"
    / "preprint"
    / "gsia_preprint_v2_status_supplement_2026-07-21.csv"
)
OUT_DIR = ROOT / ".tmp"

# CSV column -> registry field. Only fields the preprint actually reports.
FIELD_MAP = {
    "record_name": "name",
    "maturity": "maturity",
    "method_role": "methodRole",
    "contribution_class": "contribution",
    "can_render": "canRender",
    "formula_status": "formulaStatus",
    "implemented_formula": "implementedFormula",
    "proposed_formula": "proposedFormula",
    "required_inputs": "requiredInputs",
}

# Counts the preprint abstract and Tables 2-3 assert.
EXPECTED_MATURITY = {"M3": 37, "M2": 16, "M1": 38}
EXPECTED_ROLES = {
    "primary": 15,
    "variant": 10,
    "component": 12,
    "reference": 1,
    "research-model": 51,
    "retired": 2,
}


def load_registry() -> list[dict]:
    """Dump the ES-module registry to JSON via node."""
    script = (
        "import('./src/atlas-indices.js').then(m => {"
        "  console.log(JSON.stringify(m.ATLAS_INDICES.map(i => ({"
        "    acronym: i.acronym, key: i.key, name: i.name, maturity: i.maturity,"
        "    methodRole: i.methodRole, contribution: i.contribution,"
        "    canRender: !!i.canRender, formulaStatus: i.formulaStatus,"
        "    implementedFormula: i.implementedFormula,"
        "    proposedFormula: i.proposedFormula, requiredInputs: i.requiredInputs,"
        "  }))));"
        "}).catch(e => { console.error(e); process.exit(1); });"
    )
    result = subprocess.run(
        ["node", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)


def normalize(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return " | ".join(str(item) for item in value)
    return str(value).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--supplement", type=Path, default=DEFAULT_SUPPLEMENT)
    parser.add_argument(
        "--strict", action="store_true", help="exit non-zero when drift is present"
    )
    args = parser.parse_args()

    if not args.supplement.exists():
        print(f"Supplement not found: {args.supplement}", file=sys.stderr)
        return 2

    registry = load_registry()
    with args.supplement.open(newline="", encoding="utf-8") as handle:
        supplement = list(csv.DictReader(handle))

    by_acronym = {row["record_id"]: row for row in supplement}
    lines: list[str] = []

    lines.append(f"- Registry records: {len(registry)}")
    lines.append(f"- Supplement records: {len(supplement)}")

    missing = [r["record_id"] for r in supplement if r["record_id"] not in {i["acronym"] for i in registry}]
    added = [i["acronym"] for i in registry if i["acronym"] not in by_acronym]
    if missing:
        lines.append(f"- **In supplement, absent from registry:** {', '.join(missing)}")
    if added:
        lines.append(f"- **In registry, absent from supplement:** {', '.join(added)}")

    # Counts the preprint asserts must still hold.
    maturity = Counter(i["maturity"] for i in registry)
    roles = Counter(i["methodRole"] for i in registry)
    count_problems: list[str] = []
    for code, expected in EXPECTED_MATURITY.items():
        if maturity.get(code, 0) != expected:
            count_problems.append(
                f"maturity {code}: registry {maturity.get(code, 0)} vs preprint {expected}"
            )
    for role, expected in EXPECTED_ROLES.items():
        if roles.get(role, 0) != expected:
            count_problems.append(
                f"role {role}: registry {roles.get(role, 0)} vs preprint {expected}"
            )

    drift: list[tuple[str, str, str, str]] = []
    for index in registry:
        row = by_acronym.get(index["acronym"])
        if not row:
            continue
        for column, field in FIELD_MAP.items():
            live = normalize(index.get(field))
            published = normalize(row.get(column))
            if live != published:
                drift.append((index["acronym"], column, published, live))

    report = ["# GSIA registry vs published preprint supplement", ""]
    report.append(f"Supplement: `{args.supplement.name}`")
    report.append("")
    report.extend(lines)
    report.append("")

    report.append("## Asserted counts")
    if count_problems:
        report.append("Counts reported in the preprint NO LONGER hold:")
        report.extend(f"- {problem}" for problem in count_problems)
    else:
        report.append("All maturity and method-role counts reported in the preprint still hold.")
    report.append("")

    report.append(f"## Field drift ({len(drift)} differences)")
    if not drift:
        report.append("No field-level drift.")
    else:
        report.append("| Record | Field | Published (v2 snapshot) | Current registry |")
        report.append("|---|---|---|---|")
        for acronym, column, published, live in sorted(drift):
            report.append(
                f"| {acronym} | {column} | {published[:120] or '—'} | {live[:120] or '—'} |"
            )
    report.append("")
    report.append(
        "Drift is expected when the app corrects forward. Each row above should be "
        "reflected in an erratum or a superseding supplement before the preprint "
        "record is cited as describing the current deployment."
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "preprint_supplement_reconciliation.md"
    out_path.write_text("\n".join(report) + "\n", encoding="utf-8")

    print(f"Records: registry {len(registry)}, supplement {len(supplement)}")
    print(f"Count problems: {len(count_problems)}")
    print(f"Field drift: {len(drift)}")
    print(f"Report: {out_path.relative_to(ROOT)}")

    if args.strict and (drift or count_problems or missing or added):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
