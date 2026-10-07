---
name: excel-export-numeric-amounts
overview: Keep amount cells numeric in Excel/CSV exports by splitting currency into a sibling column so SUM and other formulas work.
source: grill-me session /start-work
clickup_task_url: https://app.clickup.com/t/869fd10bu
isProject: false
---

# Excel export — numeric amount cells

## Problem Statement

When users export lists or reports that include money amounts, the currency code (for example `ILS` or `USD`) is written into the same cell as the amount. Excel treats those cells as text, so formulas like `SUM` fail. The same problem shows up in CSV exports that people open in Excel, and in scheduled/emailed report attachments built on the server.

## Solution

Exports that include money-with-currency values split each affected column into:

- an **Amount** column whose cell is a real number (summable), and
- a sibling **Currency** column (for example `Outstanding (Currency)`) with the currency code when present.

The amount column keeps its original header name. Currency columns are added only when at least one value in that column looks like money-with-currency text. Bare numbers stay numbers; if currency cannot be read, the Currency cell is left blank. The same rules apply to Excel and CSV in the app UI, and to backend-built scheduled/emailed report files. PDF money display is unchanged.

## User Stories

1. As a collections manager, I want exported invoice amounts to be real numbers, so that I can use `SUM` in Excel.
2. As a collections manager, I want each amount column to keep a Currency sibling when currency was present, so that I still know which currency each row uses.
3. As a collections manager, I want multi-currency exports to keep currency per row, so that I do not mix ILS and USD in one unlabeled column.
4. As a credit analyst, I want customer outstanding exports to be summable, so that I can build quick totals without cleaning the file.
5. As a finance user, I want CSV exports to follow the same Amount + Currency split as Excel, so that opening CSV in Excel behaves the same way.
6. As a report viewer, I want report Excel/CSV downloads to split money-with-currency cells, so that custom reports are formula-friendly.
7. As a schedule owner, I want emailed/scheduled report attachments to use the same split, so that overnight files are usable without manual cleanup.
8. As a user exporting a view that already has explicit currency-column config, I want headers to match the new rule (`Amount` name + `(Currency)` sibling), so that exports look consistent.
9. As a user exporting a column that is already bare numbers, I want no empty Currency column added, so that the sheet stays clean.
10. As a user exporting a mixed column (some values with currency codes, some without), I want amounts as numbers and blank Currency where unknown, so that formulas still work and we do not invent a currency.
11. As a Hebrew-locale user, I want money strings that put the currency after the amount to split correctly, so that local formatting does not break the export.
12. As an English-locale user, I want money strings that put the currency before or after the amount to split correctly, so that both display styles export cleanly.
13. As a user exporting days/count columns, I want those columns left alone (no Currency sibling), so that non-money numerics are not treated as currency.
14. As a user exporting policy numbers, I want identifiers to stay text, so that Excel does not turn them into decimals.
15. As a user who already relies on an Amount column name, I want that header unchanged after the split, so that my downstream sheets and macros keep working.
16. As a product owner, I want one rule shared by grid exports and report file exports, so that users are not surprised by format differences.
17. As a developer, I want the fix concentrated in the exporters, so that we do not have to rewire every list screen that pre-formats money.
18. As a developer, I want mirrored helpers in frontend and backend (not a new shared package), so that the bugfix stays small.
19. As a QA engineer, I want a clear How to test path for UI export and scheduled files, so that acceptance is straightforward.
20. As a user exporting PDF, I want amounts to remain human-readable with currency as today, so that printable reports stay clear (no change required for this PRD).
21. As a control-center user, I want orphan-invoice and similar list exports to become summable, so that ops cleanup work is faster.
22. As a dashboard drill-down user, I want chart-details amount exports to become summable, so that ad-hoc analysis works in Excel.
23. As an account with a single currency, I want Currency filled from the cell text when present, so that the file still documents the currency without stuffing it into the amount cell.
24. As an account with missing currency on some rows, I want blank Currency cells rather than a guessed account default, so that bad data is visible.
25. As a user selecting a subset of columns, I want only selected money columns to split when needed, so that export column choice still controls the file shape.

## Implementation Decisions

- **Decision log (locked):** D1 number + Currency column; D2 all amount exports; D3 CSV same as Excel; D4 auto-split in exporters; D5 real number amounts; D6 blank Currency when unknown; D7 Currency column only if ≥1 money-with-currency value; D8 headers `{Header}` + `{Header} (Currency)`; D9 backend scheduled/emailed files included; D10 mirrored FE/BE helpers (no new package); D11 explicit `currencyColumns` headers align with D8.
- **Frontend:** Extend the shared grid/report Excel+CSV exporter so that, before writing cells, it detects money-with-currency strings, replaces the amount with a real number, and inserts a Currency sibling column when needed. Existing explicit currency-column config must produce numeric amounts and the same header rule. Stop treating formatted money strings as intentional text that blocks numeric typing.
- **Backend:** Apply the same split/number rules when building scheduled/emailed report CSV/Excel payloads so attachments match UI exports.
- **Detection:** Reuse/extend existing “looks like formatted currency” / split patterns already used for currency-first and amount-first strings (codes and common symbols).
- **Non-goals in implementation:** No database/schema changes. No new shared npm package. No requirement to remove every call site that pre-formats money with a currency code (exporter must still split). PDF export formatting unchanged.
- **i18n:** No new user-facing UI copy expected; if any export dialog string changes, ship English and Hebrew together.
- **Repos seams (agreed):** (1) Frontend export transform — money-with-currency input → numeric amount + Currency column for Excel and CSV; (2) Backend report file export — same rules for scheduled/emailed attachments.

## Testing Decisions

- Prefer checking external behavior at the two agreed seams, not internal helper names.
- Good checks: given sample rows, assert amount cells are numbers, currency lands in the sibling column, bare-number columns do not gain empty Currency columns, and headers follow `{Header}` / `{Header} (Currency)`.
- Manual acceptance: export a grid with amounts, open in Excel, run `SUM`; repeat for a report download; spot-check a scheduled/emailed attachment when available.
- Automated tests only if explicitly requested later; prior art would be unit tests around the export transform helpers in frontend/tests and backend report export utilities.
- Do not assert ExcelJS styling details beyond cell value type and column presence.

## Out of Scope

- Changing how amounts appear on screen in the app (grids/cards), only export file shape.
- PDF export money formatting.
- Stopping every screen from calling money formatters before export (optional cleanup later).
- Extracting a new shared package used by both apps.
- Inventing account-default currency when the cell has none.
- Database migrations or API contract changes unrelated to export payload shape.
- Force-changing unrelated numeric columns (days, counts, policy identifiers).

## Further Notes

- ClickUp task: https://app.clickup.com/t/869fd10bu
- Primary planning repo: backend; frontend branch with the same name is created when frontend files change.
- Feature branch (primary): `fix/excel-export-numeric-amounts-CU-869fd10bu`
- Parked unrelated WIP on backend via git stash before branching from `staging`; restore on `feat/portfolio-health-topup-shell-kpi` when returning to that work.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/excel-export-numeric-amounts/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/excel-export-numeric-amounts/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | UI Excel/CSV numeric amounts + Currency column | `issues/01-ui-export-numeric-amounts.md` | — | 1–6, 8–15, 14, 21–25 |
| 2 | Backend scheduled/emailed report file split | `issues/02-backend-report-export-numeric-amounts.md` | — | 7, 16, 18 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
