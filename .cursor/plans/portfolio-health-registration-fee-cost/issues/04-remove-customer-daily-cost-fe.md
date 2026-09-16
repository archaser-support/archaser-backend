# 04 — Remove customer daily-cost FE

**Status:** done  
**Priority:** normal  
**Blocked by:** —  
**User stories:** 11, 12  
**PRD:** `.cursor/plans/portfolio-health-registration-fee-cost.prd.md`

## What to build

Remove the already-hidden customer dashboard daily insurance cost KPI and chart path (`showDailyInsuranceCostChange = false` and related components/wiring).

Delete or stop importing the chart component and daily-cost view-model usage from the customer dashboard cards. Leave CPT daily cost storage, snapshot writers, and report `*_daily_cost_change` fields unchanged — customer “cost per customer” for Actual Sales is expected via Report Builder formulas later, not this UI.

Can ship in parallel with slices 01–03. Prefer a clean removal over leaving dead gated branches.

## Acceptance criteria

- [x] Customer dashboard no longer contains the daily-cost KPI/chart code path (no hard-coded `false` flag guarding dead UI).
- [x] Chart component / view-model removed or unused and cleaned up from the customer page.
- [x] No change to CPT cost persistence or report metadata daily-cost-change fields.
- [x] Customer page still loads; other dashboard cards unaffected.

## How to test

1. Open a customer with credit insurance coverage — page loads; daily insurance cost KPI/chart is absent (as before when gated off).
2. Smoke other customer dashboard cards (limits, utilization, etc.) still work.
3. Confirm Portfolio Health Costs tab still works independently (no regression from this cleanup).
4. Optionally confirm report metadata still lists `*_daily_cost_change` fields (storage/API left alone).
