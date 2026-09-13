# 02 — Align ReportViewer + harden tables[0] sync

**Status:** done
**Priority:** normal
**Blocked by:** [01-explicit-primary-table-config](01-explicit-primary-table-config.md)
**User stories:** 1, 7
**PRD:** `.cursor/plans/report-primary-independent-of-column-order.prd.md`

## What to build

Stop ReportViewer from treating `fields[0].table` as primary. Use the same resolution rule as execution (context → primaryTable → tables[0] → Customer).

Harden the preserve-primary / tables-order helpers so whenever `primaryTable` is set and still active, it stays at `tables[0]`. Column-order sync must never imply a primary change. Links and any viewer behavior that depended on “first field’s table” must follow resolved primary instead.

## Acceptance criteria

- [x] ReportViewer primary matches execution for the same saved config (including after column reorder).
- [x] `tables[0]` stays aligned with `primaryTable` when primary is still in the report.
- [x] Column reorder alone does not change resolved primary or `tables[0]` grain.
- [x] Customer/Invoice link metadata uses the resolved primary, not the first column’s table.

## How to test

1. Open an Invoice-primary report with Customer name as the first column.
2. Confirm viewer behavior (grain, links) matches one-row-per-invoice execution — not Customer-primary.
3. Reorder columns again; primary and row grain stay Invoice.
4. Spot-check a Customer-primary report still behaves as customer grain.
