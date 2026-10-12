# 01 — Builder toggle and viewer total row (ungrouped, single currency)

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 7, 12, 22, 23, 24
**PRD:** `.cursor/plans/report-total-row.prd.md`

## What to build

The tracer bullet for the whole feature. A report editor turns on **Show total row** in the builder's Grouping step, and it is saved on the report config. The toggle is greyed out with a hint when no field has an aggregation. When the report opens in the viewer with the setting on, the first execute request asks the server for totals. The server computes each aggregated column's total (SUM / AVG / COUNT / MIN / MAX) over every row that matches scope, saved filters, session filter overrides, search and formula filters, not just the current page. It returns the totals next to the page data and says which column carries the "Total" label. The viewer shows a row fixed at the bottom of the grid with those values. "Total" goes in the first column that has no aggregation, and other non-aggregated cells stay blank.

This slice covers **ungrouped** reports whose money columns share one currency. Grouped reports and formulas come in slice 02; mixed currencies and fully-aggregated layouts come in slice 03.

The fixed bottom row is a new piece of the shared grid. Make it an opt-in on the grid so other grids don't change. It must reuse the existing row cell layout, column widths, resizing, horizontal scroll and right-to-left behavior. **Any new styling needs explicit user approval before implementation** — stop and ask if existing theme pieces can't cover it.

Start with the PRD gate: check whether SQL-paged ungrouped reports can get totals from a database aggregate query next to the page, or whether requesting totals must switch to a full fetch. Record the finding in the PRD.

## Acceptance criteria

- [x] `showTotalRow` is saved in the report config; reports without it behave exactly as today (off)
- [x] The builder toggle sits in the Grouping step, and is disabled with a hint when no field has an aggregation
- [x] The execute request accepts a "include totals" flag and returns totals only when requested and the report has at least one aggregated column; the server ignores the flag otherwise
- [x] Totals cover every matching row (all pages), and follow saved filters, session filter overrides and search
- [x] Single-currency money totals are formatted with their currency, the same way grid money cells are
- [x] The viewer requests totals on the first page only, and shows them in a row fixed at the bottom of the grid that stays visible while scrolling and stays aligned with the columns when they're resized or scrolled sideways
- [x] "Total" appears in the first non-aggregated column in the displayed column order
- [x] Other grids that use the shared grid look and behave exactly as before
- [x] The PRD gate (database aggregate vs full fetch) is answered and written into the PRD
- [x] Matching English and Hebrew locale keys are added together (toggle label, hint, "Total")

## How to test

1. Go to Reports → create a report on Invoice with Customer name, Invoice number and Amount, and set Amount to SUM. Pick filters that match more than 20 invoices in one currency.
2. In the Grouping step, check that **Show total row** is enabled; turn it on and save.
3. Open the report. Expect a row fixed at the bottom of the grid showing "Total" under the first non-aggregated column and the Amount sum with its currency. Scroll down: the row stays visible and the number doesn't change. Check the sum against the full data set (for example a database query or an export), not just the first page.
4. Open the viewer filters and narrow the result, then type in search: the total updates to match.
5. Resize a column and scroll sideways: the total row stays aligned.
6. Remove the aggregation from Amount in the builder: the toggle becomes disabled with the hint. Open an old report that was never edited: no total row.
7. Switch to Hebrew: the label, hint and row read right to left with Hebrew text.
8. Open another grid (for example the Customers list): nothing changed.
