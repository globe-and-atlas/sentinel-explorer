#!/usr/bin/env python3
"""Pixel QC of the produced-water spill bookmarks through the COG render path.

The 2026-07-23 QC pass that produced the current candidate-strength figures
(e.g. "OBEC 10.2% at Matador Desoto") was run ad hoc, before the baseline-04.00
radiometric offset was handled. Earth Search applies that offset to most but not
all baseline >= 04.00 items, so a bare DN/10000 read some scenes 0.1 high while
reading their neighbours correctly — a silent, scene-dependent inconsistency
rather than a uniform bias. This script makes the pass reproducible and records
the resolved offset per scene, so that drift cannot go unnoticed again.

Candidate strength is the fraction of tile pixels whose alpha exceeds
`--alpha-floor`, i.e. the bright band of `colorize_screening` — NOT the generic
classifier. That is the measure the 2026-07-23 pass used, kept identical here so
the numbers are comparable.

Usage:
  python3 execution/qc_spill_cog_render.py
  python3 execution/qc_spill_cog_render.py --indices pwi hpwi --bookmarks matador-desoto-spring-2025
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from render_cog_tile import (  # noqa: E402
    INDEX_BANDS,
    configure_gdal,
    find_item,
    item_boa_offset,
    read_bands,
    render_index,
    tile_bounds,
)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / ".tmp"

# Registry acronym -> COG renderer key.
DEFAULT_INDICES = {"PWCI": "pwi", "OBEC": "hpwi", "ASAI": "pwoi", "LBI": "lbi"}


def load_bookmarks() -> list[dict]:
    """Read SPILL_BOOKMARKS out of src/app.js without importing the browser app."""
    code = """
    import { readFileSync } from 'node:fs';
    const src = readFileSync('src/app.js', 'utf8');
    const start = src.indexOf('const SPILL_BOOKMARKS = [');
    if (start < 0) { console.error('SPILL_BOOKMARKS not found'); process.exit(1); }
    let i = src.indexOf('[', start), depth = 0, end = -1;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '[') depth++;
      else if (src[j] === ']') { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    const arr = eval(src.slice(i, end));
    console.log(JSON.stringify(arr.map(b => ({
      id: b.id, label: b.label, lat: b.lat, lng: b.lng,
      zoom: b.zoom ?? 14, date: b.date, class: b.class || '',
    }))));
    """
    out = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def lonlat_to_tile(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    lat = max(-85.05112878, min(85.05112878, lat))
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def strength(rgba: np.ndarray, alpha_floor: int) -> float:
    """Fraction of pixels in the bright screening band."""
    alpha = rgba[..., 3]
    return round(float(np.count_nonzero(alpha > alpha_floor)) / alpha.size * 100.0, 3)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--indices", nargs="*", default=list(DEFAULT_INDICES.values()))
    parser.add_argument("--bookmarks", nargs="*", default=[], help="Limit to these bookmark ids.")
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--zoom", type=int, default=14)
    parser.add_argument("--maxcc", type=float, default=30.0)
    parser.add_argument("--alpha-floor", type=int, default=100)
    parser.add_argument("--window-days", type=int, default=15)
    args = parser.parse_args()

    unknown = [k for k in args.indices if k not in INDEX_BANDS]
    if unknown:
        print(f"Unsupported COG index keys: {unknown}", file=sys.stderr)
        return 2

    configure_gdal()
    bookmarks = load_bookmarks()
    if args.bookmarks:
        wanted = set(args.bookmarks)
        bookmarks = [b for b in bookmarks if b["id"] in wanted]
        if not bookmarks:
            print(f"No bookmarks matched {sorted(wanted)}", file=sys.stderr)
            return 2

    key_to_acronym = {v: k for k, v in DEFAULT_INDICES.items()}
    rows: list[dict] = []
    cache_dir = ROOT / ".tmp" / "cog_item_cache"

    for bm in bookmarks:
        zoom = int(bm.get("zoom") or args.zoom)
        x, y = lonlat_to_tile(float(bm["lng"]), float(bm["lat"]), zoom)
        bounds = tile_bounds(zoom, x, y)
        end = bm.get("date")
        if not end:
            continue
        end_dt = datetime.fromisoformat(end).replace(tzinfo=timezone.utc)
        start_dt = end_dt - timedelta(days=args.window_days)
        time_value = f"{start_dt.date().isoformat()}/{end}"

        for key in args.indices:
            record = {
                "bookmark": bm["id"], "label": bm.get("label", ""), "class": bm.get("class", ""),
                "index": key_to_acronym.get(key, key.upper()), "cog_key": key,
                "date": end, "zoom": zoom, "tile": f"{zoom}/{x}/{y}",
            }
            try:
                item = find_item(
                    "https://earth-search.aws.element84.com/v1", "sentinel-2-l2a",
                    bounds, time_value, args.maxcc, cache_dir, 7 * 24 * 3600,
                )
                bands, valid = read_bands(item, INDEX_BANDS[key], bounds, args.size)
                rgba = render_index(key, bands, valid)
                record.update({
                    "status": "ok",
                    "scene": item["id"],
                    "cloud": item.get("cloud"),
                    "boa_offset": item_boa_offset(item),
                    "candidate_strength_pct": strength(rgba, args.alpha_floor),
                })
            except Exception as exc:  # noqa: BLE001 - report, do not abort the sweep
                record.update({"status": "error", "error": str(exc)[:200]})
            rows.append(record)
            flag = record.get("candidate_strength_pct")
            print(
                f"{record['bookmark'][:34]:<34} {record['index']:<5} "
                f"{record['status']:<5} "
                + (f"strength={flag:>7}%  offset={record.get('boa_offset')}" if flag is not None else record.get("error", ""))
            )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "provider": "earth-search sentinel-2-l2a COG",
        "measure": f"fraction of pixels with alpha > {args.alpha_floor} (colorize_screening bright band)",
        "size": args.size, "maxcc": args.maxcc, "window_days": args.window_days,
        "note": (
            "Reflectance is offset-corrected for processing baseline 04.00. Figures published "
            "before 2026-07-25 used an uncorrected conversion and are not comparable."
        ),
        "results": rows,
    }
    (OUT_DIR / "spill_cog_render_qc.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

    ok = [r for r in rows if r["status"] == "ok"]
    print(f"\nRendered {len(ok)}/{len(rows)} tiles across {len(bookmarks)} bookmarks.")
    if ok:
        top = sorted(ok, key=lambda r: r["candidate_strength_pct"], reverse=True)[:6]
        print("Strongest responses:")
        for r in top:
            print(f"  {r['candidate_strength_pct']:>7}%  {r['index']:<5} {r['bookmark']}")
    print(f"Wrote {(OUT_DIR / 'spill_cog_render_qc.json').relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
