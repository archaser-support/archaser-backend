# 04 — Builder primary UX + EN/HE + repair script

**Status:** done
**Priority:** normal
**Blocked by:** [01-explicit-primary-table-config](01-explicit-primary-table-config.md), [02-align-viewer-tables-sync](02-align-viewer-tables-sync.md)
**User stories:** 2, 3, 6, 8
**PRD:** `.cursor/plans/report-primary-independent-of-column-order.prd.md`

## What to build

Show which table is primary on the builder table chips (or equivalent existing chip UI) and let the editor set primary deliberately without deleting fields. Reuse existing Chip / table-selector patterns — no new theme styles.

Add English and Hebrew locale keys for the new primary UI in the same change. Add a database repair script under scripts/database with dry-run and apply: backfill missing `primaryTable` from `tables[0]`; optional flagged heuristic to prefer Invoice when Invoice date/amount fields exist without aggregation and current primary is Customer. Do not silently rewrite on every execute.

## Acceptance criteria

- [x] Builder shows which table is primary.
- [x] Editor can set another selected table as primary; save persists `primaryTable` and grain changes on run.
- [x] Matching English and Hebrew locale keys are added/updated together.
- [x] Repair script dry-run lists candidates without writing; apply updates configs as documented.
- [x] Heuristic Invoice preference requires an explicit flag and is documented.
- [x] No new global CSS or theme tokens.

## How to test

1. Open Report Builder with Customer + Invoice selected — primary badge matches saved grain.
2. Use set-primary to switch Invoice ↔ Customer; save; run — row grain matches the choice.
3. Switch UI to Hebrew and confirm primary labels/actions.
4. Run the repair script dry-run against local DB; review output; apply only if intended.
