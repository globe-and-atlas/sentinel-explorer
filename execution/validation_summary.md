# Produced Water Detection Validation Summary

**Date:** 2026-03-28
**Sites:** 27  |  **Indices:** 10

> **Which spill count applies.** `data/rrc_spills.json` holds **32** TRRC incident
> records. This 2026-03-28 index run resolved usable Statistics API values for **27**
> of them (BPX Energy 2022-10-11, Cimarex 2023-04-28, Midland Basin Royalty Trust
> 2022-02-14, Penn Virginia Resource 2023-01-09, and Winkler County Oil Co. 2023-03-31
> are absent). The later threshold sweep refetched raw bands for all **32**
> (`execution/spill_bands.csv`) and reports on that full set. Quote **27** only for the
> detection-rate table below; quote **32** for the sweep and its negative result.

> **Superseded.** The detection rates below come from the permissive pipeline. The July
> 2026 sweep showed the high recall is an artifact of firing on ~97% of background.
> Read `reports/threshold_sweep_2026-07-20.md` before quoting any number here.

## Overall Performance

Index  Threshold  Detected  Rate  Mean   p75   p90   Max
 APEX       0.01        21 77.8% 0.335 0.465 0.713 1.000
 HPWI       0.01        18 66.7% 0.294 0.428 0.770 1.000
  PWI       0.01        22 81.5% 0.741 1.000 1.000 1.000
  LBI       0.01        17 63.0% 0.033 0.050 0.076 0.122
  TRI       0.01         2  7.4% 0.002 0.000 0.004 0.027
  BPI       0.01        15 55.6% 0.023 0.032 0.055 0.100
  VSI       0.01        20 74.1% 0.047 0.071 0.084 0.128
  CMA       0.01         2  7.4% 0.003 0.000 0.007 0.052
  PHI       0.01        12 44.4% 0.029 0.027 0.046 0.379
  HMI       0.01         5 18.5% 0.044 0.000 0.046 0.911

**Weighted composite:** 55.2%

## Notes
- FBC excluded from composite — high false-positive rate on bare caliche.
- APEX and HPWI are primary trust indices.
- Thresholds from optimize_thresholds.py where available.

## Volume Breakdown

              Volume  N       APEX       HPWI        PWI        LBI        TRI        BPI        VSI        CMA        PHI        HMI
    Small (<200 BBL)  3  2/3 (67%)  2/3 (67%)  2/3 (67%)  2/3 (67%)   0/3 (0%)  1/3 (33%)  2/3 (67%)   0/3 (0%)  1/3 (33%)   0/3 (0%)
Medium (200-500 BBL) 10 7/10 (70%) 7/10 (70%) 9/10 (90%) 6/10 (60%) 1/10 (10%) 7/10 (70%) 8/10 (80%) 1/10 (10%) 6/10 (60%) 2/10 (20%)
Large (500-1000 BBL)  7  6/7 (86%)  5/7 (71%)  6/7 (86%)  4/7 (57%)  1/7 (14%)  4/7 (57%)  5/7 (71%)   0/7 (0%)  3/7 (43%)  1/7 (14%)
   Major (>1000 BBL)  7  6/7 (86%)  4/7 (57%)  5/7 (71%)  5/7 (71%)   0/7 (0%)  3/7 (43%)  5/7 (71%)  1/7 (14%)  2/7 (29%)  2/7 (29%)