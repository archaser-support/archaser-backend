# 01 — Explicit primaryTable on config + shared resolve

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 5, 7
**PRD:** `.cursor/plans/report-primary-independent-of-column-order.prd.md`

## What to build

Persist an optional `primaryTable` on report config JSON and resolve report grain everywhere as: context override → `primaryTable` → `tables[0]` → Customer.

Hydrate and save from the builder set and keep `primaryTable` when fields change if that table is still used; if the primary table is removed, fall back to the first remaining preserved table. Set `primaryTable` when the first table is added via the table selector (not when the first column is dragged). Keep `tables[0]` equal to `primaryTable` when present so legacy readers stay correct. Entity/dashboard context overrides still win over saved primary. No Prisma schema migration.

## Acceptance criteria

- [x] Saved report config can store `primaryTable`.
- [x] Execution resolves grain with context → primaryTable → tables[0] → Customer.
- [x] Reordering columns / fields does not change `primaryTable` when that table is still selected.
- [x] Removing all fields of the primary table updates primary to a remaining table (or clears appropriately).
- [x] New reports set primary from the first table added in the table selector.
- [x] Context-forced reports still ignore a conflicting saved primary.

## How to test

1. Create a report: add Invoice table first, then Customer; add invoice date, due date, customer name.
2. Confirm saved config has `primaryTable: "Invoice"` (or equivalent) and execution is one row per invoice.
3. Drag Customer name to the first column, save, reopen — primary stays Invoice; dates still populate.
4. Remove all Invoice fields — primary becomes Customer (or the remaining table).
5. Open a context-forced list report if available — context primary still wins.
