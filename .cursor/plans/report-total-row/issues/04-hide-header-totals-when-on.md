# 04 — Hide header totals when the total row is on

**Status:** done
**Priority:** normal
**Blocked by:** [01-builder-toggle-and-viewer-total-row](01-builder-toggle-and-viewer-total-row.md)
**User stories:** 14, 15
**PRD:** `.cursor/plans/report-total-row.prd.md`

## What to build

Today a column with an aggregation shows its total inside the column header, e.g. "Amount (SUM: 52,300 USD)". When a report has the total row turned on, the header must stop showing that number so users never see two different totals. The header keeps the column name and the aggregation type. When the total row is off, the header behaves exactly as it does today.

The header numbers are still computed from loaded rows when the total row is off. That's tracked separately in the [header totals bug](https://app.clickup.com/t/869ffnajv), which is not part of this slice.

## Acceptance criteria

- [x] With the total row on, aggregated column headers show no total number
- [x] With the total row off, headers are unchanged from today (including COUNT from the server totals)
- [x] Other grids using the same column generator are unchanged
- [x] No new user-facing copy (if any is added, English and Hebrew together)

## How to test

1. Open a report with Amount set to SUM and the total row **off**: the header shows "Amount (SUM: …)" as today.
2. Edit the report, turn the total row **on**, save and reopen: the header shows the column and aggregation without a number, and the number appears only in the bottom total row.
3. Check a grouped report with a COUNT column the same way.
4. Spot-check in Hebrew.
