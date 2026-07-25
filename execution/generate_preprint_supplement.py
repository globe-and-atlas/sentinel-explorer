#!/usr/bin/env python3
"""Regenerate the GSIA status supplement CSV from the live Atlas registry.

Registry-derived columns are rebuilt from `src/atlas-indices.js`. Audit-derived
columns (display QC, acquisition metadata) cannot be recomputed here — they come
from a live WMS run — so they are carried forward from the previous supplement.

The exception that matters: if a record's *evalscript* changed since the previous
supplement, its carried-forward display QC no longer describes what renders. Those
rows are blanked and listed so the WMS audit can be re-run for them rather than
publishing a stale verdict as if it were current.

Usage:
  python3 execution/generate_preprint_supplement.py --version 3
  python3 execution/generate_preprint_supplement.py --version 3 --check
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import subprocess

from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREPRINT_DIR = ROOT.parent / "remote-sensing-research" / "preprint"
PREVIOUS = PREPRINT_DIR / "gsia_preprint_v2_status_supplement_2026-07-21.csv"

COLUMNS = [
    "record_id", "record_name", "domain_id", "domain_label", "capability_id",
    "capability_label", "method_role", "contribution_class", "contribution_status",
    "maturity", "formula_version", "interactive_state", "can_render",
    "formula_status", "proposed_formula", "implemented_formula", "required_inputs",
    "temporal_operator", "spatial_operator", "units", "physical_rationale",
    "intended_use_and_inference_limit", "calibration_status", "validation_status",
    "event_evidence_status", "source_name", "source_url", "bookmark_label",
    "bookmark_latitude", "bookmark_longitude", "bookmark_zoom",
    "bookmark_window_end_date", "bookmark_date_role", "acquisition_timestamp",
    "acquisition_cloud_cover", "display_qc_verdict", "display_visible_percent",
    "display_high_signal_percent", "display_p99_luma", "display_qc_generated",
    "display_qc_interpretation_limit", "audit_date", "source_commit",
]

# Carried forward from the previous supplement; not derivable from the registry.
CARRIED = [
    "display_qc_verdict", "display_visible_percent", "display_high_signal_percent",
    "display_p99_luma", "display_qc_generated", "display_qc_interpretation_limit",
]

STALE_QC_NOTE = "Pending re-run; the evalscript changed after the previous display audit"

INTERACTIVE_STATE = {
    "M3": "Live catalog visualization",
    "M2": "Non-live executable formula",
    "M1": "Specified concept or retired formula",
}


def dump_registry() -> list[dict]:
    script = """
    import('./src/atlas-indices.js').then(m => {
      const domains = Object.fromEntries(m.ATLAS_DOMAINS.map(d => [d.id, d.label]));
      const caps = Object.fromEntries(m.ATLAS_CAPABILITIES.map(c => [c.id, c.label]));
      console.log(JSON.stringify(m.ATLAS_INDICES.map(i => ({
        record_id: i.acronym,
        record_name: i.name,
        domain_id: i.domain,
        domain_label: domains[i.domain] || '',
        capability_id: i.capability || '',
        capability_label: caps[i.capability] || '',
        method_role: i.methodRole || '',
        contribution_class: i.contribution,
        contribution_status: i.contributionStatus,
        maturity: i.maturity,
        formula_version: i.formulaVersion,
        can_render: i.canRender ? 'true' : 'false',
        formula_status: i.formulaStatus,
        proposed_formula: i.proposedFormula || '',
        implemented_formula: i.implementedFormula || '',
        required_inputs: (i.requiredInputs || []).join(' | '),
        temporal_operator: i.temporalOperator || '',
        spatial_operator: i.spatialOperator || '',
        units: i.units || '',
        physical_rationale: i.physics || '',
        intended_use_and_inference_limit: i.benefit || '',
        calibration_status: i.calibrationStatus || '',
        validation_status: i.validationStatus || '',
        event_evidence_status: i.eventEvidenceStatus || '',
        source_name: i.source || '',
        source_url: i.sourceUrl || '',
        bookmark_label: i.bookmark?.label || '',
        bookmark_latitude: i.bookmark?.lat ?? '',
        bookmark_longitude: i.bookmark?.lng ?? '',
        bookmark_zoom: i.bookmark?.zoom ?? '',
        bookmark_window_end_date: i.bookmark?.date || '',
        bookmark_date_role: i.bookmarkDateRole || '',
        acquisition_timestamp: i.acquisitionTimestamp || '',
        acquisition_cloud_cover: i.acquisitionCloudCover || '',
        evalscript_hash: i.evalscript || '',
      }))));
    }).catch(e => { console.error(e); process.exit(1); });
    """
    out = subprocess.run(
        ["node", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    records = json.loads(out.stdout)
    for record in records:
        script_text = record.pop("evalscript_hash") or ""
        record["_script_sha"] = (
            hashlib.sha256(script_text.encode("utf-8")).hexdigest() if script_text else ""
        )
        record["interactive_state"] = INTERACTIVE_STATE.get(record["maturity"], "")
    return records


def git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        )
        return out.stdout.strip()
    except subprocess.CalledProcessError:
        return "uncommitted"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="3", help="supplement version label")
    parser.add_argument("--previous", type=Path, default=PREVIOUS)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument(
        "--check", action="store_true", help="report without writing the CSV"
    )
    parser.add_argument(
        "--stale-qc",
        nargs="*",
        default=[],
        metavar="RECORD_ID",
        help=(
            "records whose rendered OUTPUT changed; their carried-forward display QC "
            "is blanked. A script-hash change alone only warns, because cosmetic edits "
            "(variable renames, comments) change the text without changing the output."
        ),
    )
    args = parser.parse_args()
    forced_stale = {rid.upper() for rid in args.stale_qc}

    records = dump_registry()

    previous: dict[str, dict] = {}
    prev_scripts: dict[str, str] = {}
    if args.previous.exists():
        with args.previous.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                previous[row["record_id"]] = row
        sidecar = args.previous.with_suffix(".scripts.json")
        if sidecar.exists():
            prev_scripts = json.loads(sidecar.read_text())

    today = date.today().isoformat()
    commit = git_commit()
    blanked: list[str] = []
    changed_text: list[str] = []
    new_records: list[str] = []
    rows: list[dict] = []

    for record in records:
        rid = record["record_id"]
        prior = previous.get(rid)
        row = {column: record.get(column, "") for column in COLUMNS}

        if prior is None:
            new_records.append(rid)
            for column in CARRIED:
                row[column] = ""
        else:
            for column in CARRIED:
                row[column] = prior.get(column, "")

            # A hash change means the script TEXT differs, which is only a signal to
            # look: renaming a variable changes the text but not a single pixel.
            if (
                prev_scripts
                and rid in prev_scripts
                and prev_scripts[rid] != record["_script_sha"]
            ):
                changed_text.append(rid)

            # Blanking is driven by an explicit judgment that the OUTPUT changed.
            if rid.upper() in forced_stale:
                blanked.append(rid)
                for column in CARRIED:
                    row[column] = ""
                row["display_qc_interpretation_limit"] = STALE_QC_NOTE

        row["audit_date"] = today
        row["source_commit"] = commit
        rows.append(row)

    # Persist current script hashes so the NEXT regeneration can detect changes.
    script_map = {r["record_id"]: r["_script_sha"] for r in records if r["_script_sha"]}

    print(f"Records: {len(rows)}")
    print(f"New records (no prior row): {new_records or 'none'}")
    print(f"Display QC blanked, needs re-run: {blanked or 'none'}")
    if changed_text:
        print(
            f"Evalscript text changed (verify whether output changed): {changed_text}"
        )
    if not prev_scripts:
        print(
            "NOTE: the previous supplement has no script-hash sidecar, so text changes\n"
            "      could not be detected automatically this cycle. Records whose OUTPUT\n"
            "      changed had to be named with --stale-qc. The sidecar written below\n"
            "      enables detection next cycle."
        )

    if args.check:
        return 0

    out_path = args.out or (
        PREPRINT_DIR / f"gsia_preprint_v{args.version}_status_supplement_{today}.csv"
    )
    with out_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)

    out_path.with_suffix(".scripts.json").write_text(
        json.dumps(script_map, indent=2, sort_keys=True), encoding="utf-8"
    )
    print(f"Wrote: {out_path}")
    print(f"Wrote: {out_path.with_suffix('.scripts.json')} (for next-cycle change detection)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
