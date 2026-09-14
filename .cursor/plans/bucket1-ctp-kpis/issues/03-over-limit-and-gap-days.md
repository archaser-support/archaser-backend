# 03 — Chronic over-limit + capacity-gap-days

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** [01-shared-ctp-series-utilities](01-shared-ctp-series-utilities.md)
**User stories:** 1, 2, 7, 8, 28
**PRD:** `.cursor/plans/bucket1-ctp-kpis.prd.md`

## What to build

Ship KPI #1 (chronic over-limit / capacity-breach persistence) and KPI #4 (capacity-gap-days) end-to-end: domain calc from CTP `capacity_gap_amount` / usage over 100%, Customer dashboard status line, Portfolio Health Tab 1 cards (portfolio avg % days over limit, longest streak, avg daily gap), and **exportable** drill-down reports (per-customer avg gap, gap-days total, % days with gap, streak fields). Zero available days → “no data”, not 0%. Customers never over limit still appear on the gap report with $0 avg. Purpose tooltips on new cards. EN+HE copy.

## Acceptance criteria

- [ ] Customer shows over-limit N of M available days and current streak when applicable
- [ ] Portfolio Health Tab 1 shows portfolio avg % days over limit, longest streak with customer drill-through, and avg daily gap with ranked drill-down
- [ ] Exportable reports include the fields listed in the PRD/prompts
- [ ] Missing snapshot days excluded; streak resets on any clean available day
- [ ] EN+HE purpose tooltips on new cards
- [ ] Manual check against live CTP using Bucket 1 C1 acceptance logic (100% over-limit persistence when applicable)

## How to test

1. Pick a customer known chronically over limit → Customer dashboard shows N/M days and streak dates.
2. Portfolio Health for the same range → Tab 1 cards populate; open drill-down/export and find that customer ranked by avg daily gap.
3. Customer never over limit → report row shows $0 avg gap, not omitted.
4. Customer with no CTP days in range → “no data”, not 0%.
5. Hebrew spot-check on new card labels/tooltips.
