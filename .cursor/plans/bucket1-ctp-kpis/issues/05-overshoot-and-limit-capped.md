# 05 — Utilization overshoot + limit-capped detection

**Status:** done
**Priority:** normal
**Blocked by:** [01-shared-ctp-series-utilities](01-shared-ctp-series-utilities.md)
**User stories:** 3, 4, 5, 6, 28
**PRD:** `.cursor/plans/bucket1-ctp-kpis.prd.md`

## What to build

Ship KPI #2 (utilization overshoot magnitude) and KPI #3 (limit-capped / compliant-exposure ceiling). Customer card: avg overshoot points, avg/peak usage subtext, overshoot sparkline. PH Utilization tab: sortable/exportable per-customer overshoot ranking. Exclude customers with null/no effective limit (not as 0). Limit-capped banner + dual normalized AR vs compliant series only when CV/growth thresholds fire and ≥~14 available days. Purpose tooltips + EN+HE. Full exportable reports for overshoot ranking and any limit-capped cohort list.

## Acceptance criteria

- [x] Overshoot floors at 0 on under-100% days; mean/max with date returned
- [x] Null-limit customers excluded from overshoot
- [x] Limit-capped flag uses configurable defaults; suppressed on short windows
- [x] Banner shows AR growth % vs compliant growth % when flag true
- [x] Dual-line normalized chart only when flag true
- [x] Exportable overshoot report available from PH Utilization
- [x] EN+HE purpose tooltips

## How to test

1. Chronically over-utilized customer → avg overshoot points and peak usage show; sparkline non-empty.
2. PH Utilization → sort/export by overshoot; null-limit customers absent.
3. Limit-capped customer (flat compliant, rising AR) → banner + dual chart; short range (<14 days) suppresses flag.
4. Hebrew spot-check.
