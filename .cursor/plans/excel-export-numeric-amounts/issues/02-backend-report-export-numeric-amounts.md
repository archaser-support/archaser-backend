# 02 — Backend scheduled/emailed report file split

**Status:** done
**Priority:** normal
**Blocked by:** —
**User stories:** 7, 16, 18
**PRD:** `.cursor/plans/excel-export-numeric-amounts.prd.md`

## What to build

Apply the same Amount + Currency split and real-number amount rules when the backend builds scheduled/emailed report CSV/Excel files (the report file export path used by cron/internal export).

Mirror the frontend rules (no new shared package): detect money-with-currency text, write numeric amounts, add `{Header} (Currency)` only when needed, blank Currency when unknown. PDF remains out of scope.

Can proceed in parallel with slice 01; keep behavior aligned with the PRD decision log.

## Acceptance criteria

- [x] Backend-built report CSV/Excel payloads split money-with-currency values into numeric amount + Currency sibling
- [x] Headers follow `{Header}` + `{Header} (Currency)`
- [x] Currency column omitted when the column has no money-with-currency values
- [x] Behavior matches the UI exporter rules from the PRD (mirrored helper, not a new package)

## How to test

1. Trigger or obtain a scheduled/emailed report export that includes amount fields (or call the internal report export path used by schedules with a report that has money columns).
2. Open the attachment/file in Excel or Sheets.
3. Confirm amount cells are numbers, Currency siblings exist when currency was in the values, and `SUM` works on amounts.
4. Spot-check that a report without money-with-currency text does not gain empty Currency columns.
