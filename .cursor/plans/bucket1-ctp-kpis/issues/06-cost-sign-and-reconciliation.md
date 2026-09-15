# 06 — Negative daily cost + exposure reconciliation

**Status:** done
**Priority:** normal
**Blocked by:** —
**User stories:** 14, 15, 23, 28
**PRD:** `.cursor/plans/bucket1-ctp-kpis.prd.md`

## What to build

Ship KPI #8 (anomalous negative daily cost) and KPI #13 (AR/exposure reconciliation) as **visibility** signals. Costs tab line item: N negative entries (sum $X) with exportable drill-down (customer, date, amount), filtered by default minimum-magnitude so tiny rounding noise is distinguishable. Do **not** change how existing period cost totals are summed. Reconciliation footnote on Portfolio Health: N failing rows, max |delta|, with exportable bad rows; separately call out at-risk > total AR. Do not hide underlying dashboard data. No nightly job. Purpose tooltips + EN+HE.

## Acceptance criteria

- [x] Negative cost visibility sits beside existing cost totals without changing the total formula
- [x] Configurable minimum magnitude applied for “worth flagging”
- [x] Reconciliation footnote + exportable report; stronger at-risk>total signal distinct
- [x] Flagged rows still appear in other views
- [x] EN+HE copy/tooltips

## How to test

1. Portfolio Health Costs tab for a range with known negative `policy_daily_cost` → line item count/sum; open export and find sample rows.
2. Confirm period policy cost total matches prior behavior (negatives still net into total as today).
3. Account/range with known exposure identity breaks → footnote and report list deltas; dashboard charts still render.
4. Hebrew spot-check.
