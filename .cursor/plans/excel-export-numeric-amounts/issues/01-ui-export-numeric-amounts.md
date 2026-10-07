# 01 — UI Excel/CSV numeric amounts + Currency column

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 17, 21, 22, 23, 24, 25
**PRD:** `.cursor/plans/excel-export-numeric-amounts.prd.md`

## What to build

Update the shared frontend Excel/CSV exporter so money-with-currency values (for example `1,500.00 ILS`) become a real number in the amount column plus a sibling Currency column when needed.

Rules (from the locked decision log):

- Amount cell is a real number (not text).
- Headers: keep the original amount header; add `{Header} (Currency)`.
- Add a Currency column only when that column has at least one money-with-currency value.
- If currency cannot be read, leave Currency blank; do not invent an account default.
- Same behavior for Excel and CSV.
- Explicit `currencyColumns` config uses the same header rule and numeric amounts.
- Do not treat formatted money strings as intentional non-numeric text that blocks formulas.
- Leave days/counts/policy identifiers alone.

Primary work is in the frontend exporter used by grids and report viewer Excel/CSV downloads. Create the same branch name from `staging` in the frontend repo when changing files there.

## Acceptance criteria

- [x] Exporting a grid/report column that contains money-with-currency text yields a numeric amount column and a `{Header} (Currency)` sibling
- [x] Excel `SUM` (or equivalent) works on the amount column
- [x] CSV uses the same split and numeric amounts
- [x] Columns with only bare numbers do not gain an empty Currency column
- [x] Explicit `currencyColumns` exports use `{Header}` + `{Header} (Currency)` and numeric amounts
- [x] Non-money numerics (days/counts) and policy identifiers are unchanged

## How to test

1. Open a list or report that shows amounts with currency (for example invoices or customers outstanding).
2. Export to Excel; open the file.
3. Confirm amount cells are numbers and a Currency column exists beside them; run `SUM` on the amount column.
4. Export the same view as CSV; open in Excel/Sheets and confirm the same split and summable amounts.
5. Export a view whose amount values are already bare numbers — no empty Currency column should appear.
