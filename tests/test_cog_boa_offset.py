#!/usr/bin/env python3
"""Regression tests for the Sentinel-2 baseline 04.00 radiometric offset.

Guards the defect found in the 2026-07-25 scientific review: `read_bands`
divided raw ESA DN by 10000 with no BOA_ADD_OFFSET, so every COG-provider
reflectance for a post-2022-01-25 scene read ~0.1 high relative to the
Sentinel Hub provider (which harmonizes by default).

Run:
  python3 tests/test_cog_boa_offset.py
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "execution"))

from render_cog_tile import (  # noqa: E402
    BOA_ADD_OFFSET,
    QUANTIFICATION_VALUE,
    item_boa_offset,
    resolve_boa_offset,
)

FAILURES: list[str] = []


def check(label: str, actual, expected) -> None:
    if actual != expected:
        FAILURES.append(f"{label}: expected {expected!r}, got {actual!r}")


UTC = timezone.utc

# --- resolve_boa_offset: baseline property is authoritative -----------------
check(
    "baseline 05.00 gets the offset",
    resolve_boa_offset({"s2:processing_baseline": "05.00"}, None),
    BOA_ADD_OFFSET,
)
check(
    "baseline 04.00 gets the offset",
    resolve_boa_offset({"s2:processing_baseline": "04.00"}, None),
    BOA_ADD_OFFSET,
)
check(
    "baseline 03.01 gets no offset",
    resolve_boa_offset({"s2:processing_baseline": "03.01"}, None),
    0.0,
)

# --- the double-correction guard -------------------------------------------
# If the archive already applied the offset, applying it again would subtract
# 0.1 reflectance a second time. This must win over every other signal.
check(
    "archive-applied offset is not applied twice",
    resolve_boa_offset(
        {"earthsearch:boa_offset_applied": True, "s2:processing_baseline": "05.00"},
        datetime(2024, 6, 1, tzinfo=UTC),
    ),
    0.0,
)

# --- date fallback when properties are absent ------------------------------
check(
    "post-cutover date falls back to the offset",
    resolve_boa_offset({}, datetime(2022, 3, 1, tzinfo=UTC)),
    BOA_ADD_OFFSET,
)
check(
    "pre-cutover date falls back to no offset",
    resolve_boa_offset({}, datetime(2021, 12, 1, tzinfo=UTC)),
    0.0,
)
check(
    "cutover day itself takes the offset",
    resolve_boa_offset({}, datetime(2022, 1, 25, tzinfo=UTC)),
    BOA_ADD_OFFSET,
)
check("no properties and no date is a no-op", resolve_boa_offset({}, None), 0.0)

# --- item_boa_offset: cached items lacking the new field ---------------------
# Items cached before this fix have neither `boa_offset` nor
# `processing_baseline`; they must still resolve correctly from datetime.
check(
    "legacy cached item resolves from datetime",
    item_boa_offset({"datetime": "2023-05-04T17:21:09.024Z"}),
    BOA_ADD_OFFSET,
)
check(
    "legacy pre-2022 cached item resolves to no offset",
    item_boa_offset({"datetime": "2018-01-22T18:54:21.026Z"}),
    0.0,
)
check(
    "explicit boa_offset on a fresh item is honored",
    item_boa_offset({"boa_offset": 0.0, "datetime": "2023-05-04T17:21:09.024Z"}),
    0.0,
)

# --- the numeric consequence the review flagged -----------------------------
dn = 2500.0
corrected = (dn + BOA_ADD_OFFSET) / QUANTIFICATION_VALUE
uncorrected = dn / QUANTIFICATION_VALUE
check("post-baseline reflectance is 0.15 not 0.25", round(corrected, 6), 0.15)
check("the omitted correction was worth 0.1", round(uncorrected - corrected, 6), 0.1)

# A normalized ratio is NOT invariant to the additive offset — this is why the
# bug reached every index, not just the absolute-threshold ones.
nir_dn, red_dn = 3000.0, 1500.0
nd_correct = ((nir_dn - 1000) - (red_dn - 1000)) / ((nir_dn - 1000) + (red_dn - 1000))
nd_biased = (nir_dn - red_dn) / (nir_dn + red_dn)
check("normalized difference was biased toward zero", nd_biased < nd_correct, True)
# 0.60 correct vs 0.33 biased: a 0.27 NDVI-scale error on a single scene.
check("bias magnitude is material", round(nd_correct - nd_biased, 4), 0.2667)

if FAILURES:
    print("FAILED")
    for failure in FAILURES:
        print(f"  - {failure}")
    sys.exit(1)

print("test_cog_boa_offset: all checks passed")
