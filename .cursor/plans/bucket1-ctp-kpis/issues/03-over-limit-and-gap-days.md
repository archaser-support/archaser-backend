# 03 — Chronic over-limit + capacity-gap-days

**Status:** done
**Priority:** high
**Blocked by:** [01-shared-ctp-series-utilities](01-shared-ctp-series-utilities.md)
**User stories:** 1, 2, 7, 8, 28
**PRD:** `.cursor/plans/bucket1-ctp-kpis.prd.md`

## What to build

Ship KPI #1 (chronic over-limit / capacity-breach persistence) and KPI #4 (capacity-gap-days) end-to-end: domain calc from CTP `capacity_gap_amount` / usage over 100%, Customer dashboard status line, Portfolio Health Tab 1 cards (portfolio avg % days over limit, longest streak, avg daily gap), and **exportable** drill-down reports (per-customer avg gap, gap-days total, % days with gap, streak fields). Zero available days → “no data”, not 0%. Customers never over limit still appear on the gap report with $0 avg. Purpose tooltips on new cards. EN+HE copy.

## Acceptance criteria

- [x] Customer shows over-limit N of M available days and current streak when applicable
- [x] Portfolio Health Tab 1 shows portfolio avg % days over limit, longest streak with customer drill-through, and avg daily gap with ranked drill-down
- [x] Exportable reports include the fields listed in the PRD/prompts
- [x] Missing snapshot days excluded; streak resets on any clean available day
- [x] EN+HE purpose tooltips on new cards
- [x] Manual check against live CTP using Bucket 1 C1 acceptance logic (100% over-limit persistence when applicable)

## How to test

1. Pick a customer known chronically over limit → Customer dashboard (cards + header) shows N/M available days and current streak dates when the streak is active.
2. Portfolio Health for the same range → Tab 1 cards populate (avg % days over limit, longest streak with customer link, avg daily gap); open drill-down/export and find that customer ranked by avg daily gap.
3. Customer never over limit → report row shows $0 avg gap, not omitted.
4. Customer with no CTP days in range → “no data”, not 0%.
5. Hebrew spot-check on new card labels/tooltips.

### Leftover live CTP manual checks (Bucket 1 C1)

Do **not** invent automated fixtures from the anonymized export. Against a live account with CTP history:

- **C1 over-limit persistence:** For a customer that was over limit on every available CTP day in the window, confirm Customer N/M equals available days (e.g. export reference was 181/181) and % days over limit is 100% when applicable—not diluted by missing calendar days.
- **Streak reset:** Confirm a clean available day (capacity gap = 0) resets the current over-limit streak; a missing snapshot day also breaks the streak (not treated as clean continuation).
- **Portfolio roll-up:** Longest streak card drill-through opens the matching customer; capacity gap-days report export includes avg daily gap, dollar-days, % days with gap, days available, over-limit days/%, and longest streak start/end.
- **SQL seed:** Ensure `scripts/database/create-dashboard-credit-customers-capacity-gap-days-report.sql` has been applied so the system report exists per account.
