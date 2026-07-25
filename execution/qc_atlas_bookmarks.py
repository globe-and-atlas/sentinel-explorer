#!/usr/bin/env python3
"""
QC Limn Atlas bookmark signal strength via public Sentinel Hub WMS.

This script intentionally does not read config-v1.js, .env, or credentials. It
uses the same public Atlas fallback WMS endpoint/layer that atlas-app.js uses
when no runtime config is supplied.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / ".tmp"
JSON_OUT = OUT_DIR / "atlas_bookmark_qc.json"
MD_OUT = OUT_DIR / "atlas_bookmark_qc.md"

DEFAULT_WMS_URL = "https://sh.dataspace.copernicus.eu/ogc/wms/959ea2c5-5892-4b36-82b3-76e6bdb93c8a"
DEFAULT_WMS_LAYER = "AGRICULTURE"


@dataclass
class QcResult:
    key: str
    acronym: str
    name: str
    domain: str
    platform: str
    can_render: bool
    date: str
    label: str
    lat: float
    lng: float
    zoom: int
    layer: str
    status: str
    verdict: str
    visible_pct: float | None = None
    high_pct: float | None = None
    p95_luma: float | None = None
    p99_luma: float | None = None
    max_luma: float | None = None
    max_chroma: float | None = None
    image_bytes: int | None = None
    reason: str = ""
    url_sample: str = ""
    best_date: str = ""
    best_verdict: str = ""
    best_visible_pct: float | None = None
    best_high_pct: float | None = None
    best_p99_luma: float | None = None
    best_score: float | None = None
    best_reason: str = ""


def load_indices() -> list[dict[str, Any]]:
    code = """
import { ATLAS_INDICES } from './src/atlas-indices.js';
const slim = ATLAS_INDICES.map(i => ({
  key: i.key,
  acronym: i.acronym,
  name: i.name,
  domain: i.domain,
  platform: i.platform,
  platformShort: i.platformShort,
  canRender: i.canRender,
  bookmark: i.bookmark,
  wmsLayer: i.wmsLayer || null,
  evalscript: i.evalscript,
  justification: i.justification || ''
}));
console.log(JSON.stringify(slim));
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def time_window(date_str: str, window_days: int) -> str:
    end = datetime.strptime(date_str, "%Y-%m-%d")
    start = end - timedelta(days=window_days)
    return f"{start.date().isoformat()}/{end.date().isoformat()}"


def bookmark_bbox(lat: float, lng: float, zoom: int, pixels: int) -> tuple[float, float, float, float]:
    lat_rad = math.radians(lat)
    meters_per_px = 156543.03392804097 * max(0.15, math.cos(lat_rad)) / (2**zoom)
    width_m = pixels * meters_per_px
    half_lat = (width_m / 111_320) / 2
    half_lng = (width_m / (111_320 * max(0.15, math.cos(lat_rad)))) / 2
    return (lng - half_lng, lat - half_lat, lng + half_lng, lat + half_lat)


def build_wms_url(
    index: dict[str, Any],
    width: int,
    height: int,
    window_days: int,
    maxcc: int,
    wms_url: str,
    date_override: str | None = None,
) -> tuple[str, dict[str, str]]:
    bm = index["bookmark"]
    bbox = bookmark_bbox(float(bm["lat"]), float(bm["lng"]), int(bm["zoom"]), width)
    encoded_script = base64.b64encode(index["evalscript"].encode("utf-8")).decode("ascii")
    layer = index.get("wmsLayer") or DEFAULT_WMS_LAYER
    date_str = date_override or bm["date"]
    params = {
        "service": "WMS",
        "request": "GetMap",
        "version": "1.3.0",
        "layers": layer,
        "format": "image/png",
        "transparent": "true",
        "width": str(width),
        "height": str(height),
        "crs": "CRS:84",
        "bbox": ",".join(f"{value:.8f}" for value in bbox),
        "time": time_window(date_str, window_days),
        "maxcc": str(maxcc),
        "showlogo": "false",
        "evalscript": encoded_script,
    }
    return wms_url, params


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    index = min(len(sorted_values) - 1, max(0, int(round((pct / 100) * (len(sorted_values) - 1)))))
    return sorted_values[index]


def analyze_png(data: bytes) -> dict[str, float]:
    image = Image.open(io.BytesIO(data)).convert("RGBA")
    raw_pixels = image.tobytes()
    total = image.width * image.height
    visible = 0
    high = 0
    lumas: list[float] = []
    max_luma = 0.0
    max_chroma = 0.0

    for offset in range(0, len(raw_pixels), 4):
        red = raw_pixels[offset]
        green = raw_pixels[offset + 1]
        blue = raw_pixels[offset + 2]
        alpha = raw_pixels[offset + 3]
        alpha_norm = alpha / 255
        max_channel = max(red, green, blue)
        min_channel = min(red, green, blue)
        chroma = (max_channel - min_channel) / 255
        luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
        max_luma = max(max_luma, luma)
        max_chroma = max(max_chroma, chroma)
        if alpha_norm > 0.05 and max_channel > 35:
            visible += 1
            lumas.append(luma)
        if alpha_norm > 0.2 and chroma >= 0.12 and (max_channel >= 115 or luma >= 0.45):
            high += 1

    return {
        "visible_pct": round((visible / total) * 100, 3),
        "high_pct": round((high / total) * 100, 3),
        "p95_luma": round(percentile(lumas, 95), 4),
        "p99_luma": round(percentile(lumas, 99), 4),
        "max_luma": round(max_luma, 4),
        "max_chroma": round(max_chroma, 4),
    }


def classify(metrics: dict[str, float], image_bytes: int) -> tuple[str, str]:
    visible_pct = metrics["visible_pct"]
    high_pct = metrics["high_pct"]
    p99_luma = metrics["p99_luma"]
    max_chroma = metrics["max_chroma"]

    if image_bytes < 500 or visible_pct < 0.05:
        return "blank", "No meaningful overlay signal was visible in the sampled bookmark window."
    if high_pct >= 2.0 and visible_pct >= 2.0:
        return "strong", "High-signal overlay is obvious in the bookmark window."
    if visible_pct < 2.0 and high_pct < 0.25:
        return "weak", "Overlay signal is too spatially small to be a noticeable proof target."
    if high_pct >= 0.25 or (visible_pct >= 5.0 and p99_luma >= 0.35):
        return "moderate", "Overlay signal is present but may not be an unmistakable proof target."
    return "weak", "Overlay signal is weak; this bookmark should be replaced or re-dated."


def signal_score(metrics: dict[str, float], image_bytes: int) -> float:
    if image_bytes < 500 or metrics["visible_pct"] < 0.05:
        return 0.0
    visible_component = min(metrics["visible_pct"], 100.0) * 0.15
    high_component = min(metrics["high_pct"], 100.0) * 0.75
    intensity_component = metrics["p99_luma"] * 10
    return round(visible_component + high_component + intensity_component, 4)


def date_candidates(date_str: str, sweep_days: int, step_days: int) -> list[str]:
    center = datetime.strptime(date_str, "%Y-%m-%d")
    if sweep_days <= 0:
        return [date_str]
    candidates: list[str] = []
    for offset in range(-sweep_days, sweep_days + 1, step_days):
        candidates.append((center + timedelta(days=offset)).date().isoformat())
    if date_str not in candidates:
        candidates.append(date_str)
    return sorted(set(candidates))


def fetch_metrics(
    session: requests.Session,
    index: dict[str, Any],
    args: argparse.Namespace,
    date_override: str | None = None,
) -> tuple[str, dict[str, float] | None, int, str, str]:
    url, params = build_wms_url(
        index,
        args.size,
        args.size,
        args.window_days,
        args.maxcc,
        args.wms_url,
        date_override,
    )
    try:
        response = session.get(url, params=params, timeout=args.timeout)
    except requests.RequestException as error:
        return "error", None, 0, f"Request failed: {error}", ""

    url_sample = response.url.split("&evalscript=")[0]
    if response.status_code != 200:
        return f"http-{response.status_code}", None, len(response.content), response.text[:300].replace("\n", " "), url_sample

    content_type = response.headers.get("content-type", "")
    if "image" not in content_type.lower():
        return "error", None, len(response.content), f"Expected image response, got {content_type}: {response.text[:250]}", url_sample

    try:
        metrics = analyze_png(response.content)
    except Exception as error:  # noqa: BLE001 - report exact decoder failure
        return "error", None, len(response.content), f"Could not decode image: {error}", url_sample

    return "ok", metrics, len(response.content), "", url_sample


def qc_index(session: requests.Session, index: dict[str, Any], args: argparse.Namespace) -> QcResult:
    bm = index["bookmark"]
    layer = index.get("wmsLayer") or DEFAULT_WMS_LAYER
    base = {
        "key": index["key"],
        "acronym": index["acronym"],
        "name": index["name"],
        "domain": index["domain"],
        "platform": index["platform"],
        "can_render": bool(index["canRender"]),
        "date": bm["date"],
        "label": bm["label"],
        "lat": float(bm["lat"]),
        "lng": float(bm["lng"]),
        "zoom": int(bm["zoom"]),
        "layer": layer,
    }
    if not index["canRender"]:
        return QcResult(**base, status="skipped", verdict="non-renderable", reason="Non-renderable sensor concept uses True Color context only.")

    status, metrics, image_bytes, error_reason, url_sample = fetch_metrics(session, index, args)
    if metrics is None:
        return QcResult(
            **base,
            status=status,
            verdict="error",
            image_bytes=image_bytes,
            reason=error_reason,
            url_sample=url_sample,
        )

    verdict, reason = classify(metrics, image_bytes)
    best = {
        "date": bm["date"],
        "verdict": verdict,
        "metrics": metrics,
        "score": signal_score(metrics, image_bytes),
        "reason": "Current bookmark date is the strongest tested date.",
    }
    should_sweep = args.sweep_targets == "all" or (args.sweep_targets == "needs-work" and verdict in {"blank", "weak", "moderate"})
    if args.sweep_days > 0 and should_sweep:
        for candidate_date in date_candidates(bm["date"], args.sweep_days, args.step_days):
            if candidate_date == bm["date"]:
                continue
            candidate_status, candidate_metrics, candidate_bytes, _, _ = fetch_metrics(session, index, args, candidate_date)
            if candidate_status != "ok" or candidate_metrics is None:
                continue
            candidate_score = signal_score(candidate_metrics, candidate_bytes)
            if candidate_score > best["score"]:
                candidate_verdict, candidate_reason = classify(candidate_metrics, candidate_bytes)
                best = {
                    "date": candidate_date,
                    "verdict": candidate_verdict,
                    "metrics": candidate_metrics,
                    "score": candidate_score,
                    "reason": candidate_reason,
                }
            time.sleep(0.05)

    best_metrics = best["metrics"]
    return QcResult(
        **base,
        status="ok",
        verdict=verdict,
        visible_pct=metrics["visible_pct"],
        high_pct=metrics["high_pct"],
        p95_luma=metrics["p95_luma"],
        p99_luma=metrics["p99_luma"],
        max_luma=metrics["max_luma"],
        max_chroma=metrics["max_chroma"],
        image_bytes=image_bytes,
        reason=reason,
        url_sample=url_sample,
        best_date=str(best["date"]),
        best_verdict=str(best["verdict"]),
        best_visible_pct=best_metrics["visible_pct"],
        best_high_pct=best_metrics["high_pct"],
        best_p99_luma=best_metrics["p99_luma"],
        best_score=float(best["score"]),
        best_reason=str(best["reason"]),
    )


def write_markdown(results: list[QcResult], args: argparse.Namespace, md_out: Path = MD_OUT) -> None:
    renderable = [result for result in results if result.can_render]
    counts: dict[str, int] = {}
    for result in renderable:
        counts[result.verdict] = counts.get(result.verdict, 0) + 1

    weak = [result for result in renderable if result.verdict in {"blank", "weak", "error"}]
    moderate = [result for result in renderable if result.verdict == "moderate"]
    strong = [result for result in renderable if result.verdict == "strong"]

    lines = [
        "# Limn Atlas Bookmark Signal QC",
        "",
        f"Generated: {datetime.now().isoformat(timespec='seconds')}",
        f"Renderable indices checked: {len(renderable)}",
        f"WMS layer: `{DEFAULT_WMS_LAYER}`",
        f"Window: {args.window_days} days ending on each bookmark date",
        f"Date sweep: `{args.sweep_targets}` targets, +/- {args.sweep_days} days in {args.step_days}-day steps",
        f"Tile size: {args.size} px",
        f"Max cloud cover: {args.maxcc}%",
        "",
        "## Verdict Counts",
        "",
    ]
    for verdict in ["strong", "moderate", "weak", "blank", "error"]:
        lines.append(f"- `{verdict}`: {counts.get(verdict, 0)}")

    lines.extend(
        [
            "",
            "## Weak / Blank / Error Targets",
            "",
            "| Key | Domain | Verdict | Visible % | High % | p99 luma | Current bookmark | Best tested date | Best high % | Best score | Reason |",
            "|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|",
        ]
    )
    for result in weak:
        lines.append(
            f"| {result.acronym} (`{result.key}`) | {result.domain} | {result.verdict} | "
            f"{result.visible_pct if result.visible_pct is not None else ''} | "
            f"{result.high_pct if result.high_pct is not None else ''} | "
            f"{result.p99_luma if result.p99_luma is not None else ''} | "
            f"{result.label} · {result.date} | "
            f"{result.best_date} ({result.best_verdict}) | "
            f"{result.best_high_pct if result.best_high_pct is not None else ''} | "
            f"{result.best_score if result.best_score is not None else ''} | "
            f"{result.reason} |"
        )

    lines.extend(
        [
            "",
            "## Moderate Targets",
            "",
            "| Key | Domain | Visible % | High % | p99 luma | Bookmark | Best tested date | Best score |",
            "|---|---|---:|---:|---:|---|---:|---:|",
        ]
    )
    for result in moderate:
        lines.append(
            f"| {result.acronym} (`{result.key}`) | {result.domain} | {result.visible_pct} | "
            f"{result.high_pct} | {result.p99_luma} | {result.label} · {result.date} | "
            f"{result.best_date} ({result.best_verdict}) | {result.best_score} |"
        )

    lines.extend(
        [
            "",
            "## Strong Targets",
            "",
            "| Key | Domain | Visible % | High % | p99 luma | Bookmark | Best tested date | Best score |",
            "|---|---|---:|---:|---:|---|---:|---:|",
        ]
    )
    for result in sorted(strong, key=lambda item: (item.high_pct or 0), reverse=True):
        lines.append(
            f"| {result.acronym} (`{result.key}`) | {result.domain} | {result.visible_pct} | "
            f"{result.high_pct} | {result.p99_luma} | {result.label} · {result.date} | "
            f"{result.best_date} ({result.best_verdict}) | {result.best_score} |"
        )

    md_out.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="QC renderable Limn Atlas bookmarks via public WMS overlay pixels.")
    parser.add_argument("--size", type=int, default=512, help="WMS tile width/height in pixels.")
    parser.add_argument("--window-days", type=int, default=15, help="Days before bookmark date included in WMS time range.")
    parser.add_argument("--maxcc", type=int, default=30, help="Sentinel Hub max cloud cover percentage.")
    parser.add_argument("--wms-url", default=DEFAULT_WMS_URL, help="Sentinel Hub OGC WMS endpoint to use for bookmark QC.")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout per WMS request in seconds.")
    parser.add_argument("--limit", type=int, default=0, help="Optional renderable index limit for debugging.")
    parser.add_argument("--sweep-days", type=int, default=60, help="Days before/after bookmark date to test for stronger signal.")
    parser.add_argument("--step-days", type=int, default=15, help="Date sweep increment in days.")
    parser.add_argument(
        "--sweep-targets",
        choices=["needs-work", "all", "none"],
        default="needs-work",
        help="Which current bookmark verdicts should get date sweeps.",
    )
    parser.add_argument(
        "--keys",
        nargs="*",
        default=[],
        metavar="KEY",
        help=(
            "Re-audit only these index keys (e.g. --keys dlpehi). Results are written "
            "to a -partial suffixed file so a targeted re-run never overwrites the "
            "full-catalog report."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    OUT_DIR.mkdir(exist_ok=True)
    indices = load_indices()

    json_out, md_out = JSON_OUT, MD_OUT
    if args.keys:
        wanted = {key.lower() for key in args.keys}
        known = {index["key"].lower() for index in indices}
        unknown = wanted - known
        if unknown:
            print(f"Unknown index keys: {sorted(unknown)}", file=sys.stderr)
            return 2
        indices = [index for index in indices if index["key"].lower() in wanted]
        json_out = JSON_OUT.with_name(f"{JSON_OUT.stem}-partial{JSON_OUT.suffix}")
        md_out = MD_OUT.with_name(f"{MD_OUT.stem}-partial{MD_OUT.suffix}")
        print(f"Targeted re-audit of {len(indices)} record(s): {sorted(wanted)}")

    if args.limit:
        renderable_seen = 0
        limited = []
        for index in indices:
            if index["canRender"]:
                renderable_seen += 1
                if renderable_seen > args.limit:
                    continue
            limited.append(index)
        indices = limited

    session = requests.Session()
    session.headers.update({"User-Agent": "Limn-Atlas-QC/1.0"})
    results: list[QcResult] = []
    for index in indices:
        result = qc_index(session, index, args)
        results.append(result)
        if result.can_render:
            print(f"{result.acronym:<10} {result.verdict:<8} visible={result.visible_pct} high={result.high_pct} {result.reason}")
        time.sleep(0.1)

    json_out.write_text(
        json.dumps(
            {
                "generated": datetime.now().isoformat(timespec="seconds"),
                "wms_url": args.wms_url,
                "wms_layer": DEFAULT_WMS_LAYER,
                "window_days": args.window_days,
                "maxcc": args.maxcc,
                "size": args.size,
                "results": [asdict(result) for result in results],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    write_markdown(results, args, md_out)
    print(f"\nWrote {json_out}")
    print(f"Wrote {md_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
