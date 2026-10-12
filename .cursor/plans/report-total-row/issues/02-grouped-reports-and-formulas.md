# 02 — Totals for grouped reports and formula columns

**Status:** done
**Priority:** normal
**Blocked by:** [01-builder-toggle-and-viewer-total-row](01-builder-toggle-and-viewer-total-row.md)
**User stories:** 8, 9
**PRD:** `.cursor/plans/report-total-row.prd.md`

## What to build

Extend the total row to grouped reports and to formula columns with an aggregation. In a grouped report the totals are computed from the **original detail rows**, before grouping, so an AVG total is the true overall average and not an average of the group averages. SUM, COUNT, MIN and MAX give the same result either way. Formula columns with an aggregation (SUM / AVG / MIN / MAX) are totaled the same way as fields, and formatted with the formula's own format (number, currency, percentage). Formula filters still apply to the detail rows before totals are computed.

## Acceptance criteria

- [x] Grouped reports show the total row, with totals computed from detail rows before grouping
- [x] AVG total in a grouped report equals the average over all detail rows (not the average of group values)
- [x] COUNT total equals the number of matching detail rows with a value
- [x] Aggregated formula columns get a total, formatted with the formula's format and decimals
- [x] Reports with formula filters total only the rows that pass those filters
- [x] No new user-facing copy (if any is added, English and Hebrew together)

## How to test

1. Build an Invoice report grouped by Customer, with Days overdue set to AVG and Amount set to SUM. Turn on Show total row.
2. Pick a case where one customer has 1 invoice at 100 days overdue and another has 9 invoices at 10 days. Expect the Days overdue total to read 19 (the overall average), not 55.
3. Check that the Amount total equals the sum of every invoice in scope.
4. Add a currency formula (for example Amount × 0.1) with SUM aggregation. Expect a total in that column, formatted as currency.
5. Add a formula filter (for example that formula greater than 100): the totals cover only the matching rows.
