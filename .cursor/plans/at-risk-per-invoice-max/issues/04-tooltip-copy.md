# 04 — EN/HE tooltips + unpaid capacity-gap column

**Status:** done
**Priority:** normal
**Blocked by:** —
**User stories:** 14, 24
**PRD:** `.cursor/plans/at-risk-per-invoice-max.prd.md`

## What to build

1. Keep / refresh English and Hebrew dashboard tooltip / help strings for **At Risk Exposure** (per-invoice `max(capacity gap, terms breach)`, sum, uncovered → full open AR, no portfolio residual).
2. Update **Capacity Gap** tooltips to say the card is `max(0, open AR − effective limit)` (approved + top-up when applicable)—not a sticky invoice sum.
3. Remove or stop featuring the Capacity Gap column on the **main unpaid invoices UI**; keep available on reports/exports / debug only.

Work in the frontend repo on the same branch name when editing locale files / grid config. No new styles.

**Note:** An earlier pass marked at-risk tooltips done; this slice re-opens for capacity-gap copy + unpaid column visibility per grill D10.

## Acceptance criteria

- [x] EN/HE at-risk tooltips match `Σ max(gap_i, breach_i)`
- [x] EN/HE capacity-gap tooltips match customer `AR − effective limit`
- [x] Main unpaid invoices view does not present invoice capacity gap as a primary column (reports/exports may still include it)
- [x] No unrelated translation keys / styling changes

## How to test

1. Open customer Dashboard and credit dashboard: At Risk + Capacity Gap tooltips in EN and HE.
2. Confirm Capacity Gap copy describes over effective limit, not sticky invoice allocation.
3. Open customer unpaid invoices: capacity gap is not featured as a main grid column.
4. Confirm a report/export that still includes invoice capacity gap for debug (if configured).
