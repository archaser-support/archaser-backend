# 02 — UI: top-N card, slider, and CPL rename

**Status:** done
**Priority:** normal
**Blocked by:** [01-api-top-n-cohorts](01-api-top-n-cohorts.md)
**User stories:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17
**PRD:** `.cursor/plans/portfolio-health-top-n-cpl.prd.md`

## What to build

On Portfolio Health **Health** tab:

1. Rename whole-book **Average portfolio health** / **Avg. Health** to **Credit Protection Level** (EN + HE).
2. Add a new card **immediately after Longest over-limit streak** with:
   - Credit Protection Level **gauge** for the selected top-N cohort
   - Three metrics: Total Receivable, Compliant Exposure, At-Risk Exposure (amounts + share of portfolio %)
   - Discrete **5 / 10 / 20** slider (Below-threshold pattern), default **10**, switching locally among precomputed cohorts from the API
3. Create the frontend branch with the same name as backend when first touching FE files. No graph lines.

## Acceptance criteria

- [x] Whole-book Health KPI/halo uses Credit Protection Level wording in EN and HE
- [x] New card appears after Longest over-limit streak
- [x] Gauge + three share metrics update when sliding 5 / 10 / 20 without refetch
- [x] Default slider position is 10
- [x] Matching English and Hebrew locale keys are added/updated together
- [x] No new customer lines on Health charts

## How to test

1. Open Portfolio Health → Health tab (EN): confirm whole-book label is Credit Protection Level.
2. Confirm the new card sits after Longest over-limit streak; default slider shows Top 10 metrics.
3. Move slider to 5 and 20; gauge and three shares change immediately (no loading flash from N alone).
4. Switch locale to Hebrew; spot-check rename, card title, slider label, and three metric labels.
5. Confirm daily/monthly Health charts are unchanged (no extra customer lines).
