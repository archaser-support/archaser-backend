---
name: report-builder-formula-comparisons
overview: Let Report Builder formula columns compare dates and numbers, show Yes/No, and document the language from a Help control in the formula editor.
source: grill-me session for ClickUp 869ez1bd0 (2026-09-09)
clickup_task_url: https://app.clickup.com/t/25708732/869ez1bd0
isProject: false
---

# Report Builder formula comparisons

## Problem Statement

Report editors cannot tell from a formula whether two dates match. The first business need is to compare **invoice date** to **due date** and show whether they are the same calendar day. Today formulas only do number math (`+ − × ÷`). Date fields cannot be picked, there is no compare operator, and there is no Yes/No format. Editors also have no in-editor help that explains the formula language.

## Solution

Extend formula columns so editors can compare **date**, **date-and-time**, and **number** fields (and typed dates like `2026-03-01`) using `= != < > <= >=`. Date-only fields compare by **calendar day**. Date-and-time fields compare by **full date and time**. The editor picks **Yes/No** as a fourth result format. On screen and in CSV/Excel the cell shows Yes or No. Underneath, Yes is `1` and No is `0` so other formulas and grouped SUM/AVG/MIN/MAX can use the result. A Help control in the formula editor opens a help page with short rules and copy-paste examples.

## User Stories

1. As a report editor, I want to pick invoice date in a formula, so that I can compare it to other dates.
2. As a report editor, I want to pick due date in a formula, so that I can compare it to invoice date.
3. As a report editor, I want any date-only report field as a formula operand, so that compares are not limited to invoices.
4. As a report editor, I want any date-and-time report field as a formula operand, so that I can compare created-at style fields.
5. As a report editor, I want `[Invoice.invoice_date] = [Invoice.due_date]` to be a valid formula, so that I can flag same-day invoices.
6. As a report reader, I want matching calendar days to show Yes, so that I can scan the report quickly.
7. As a report reader, I want different calendar days to show No, so that mismatches are obvious.
8. As a report editor, I want `!=` for dates, so that I can flag rows where two dates differ.
9. As a report editor, I want `<` and `>` for dates, so that I can tell which date is earlier or later.
10. As a report editor, I want `<=` and `>=` for dates, so that I can express on-or-before and on-or-after without two formulas.
11. As a report reader, I want two date-only fields on the same calendar day to count as equal even if stored clock times differ, so that “same day” matches what I see in the report.
12. As a report reader, I want before/after on date-only fields to use calendar days, so that 1 Mar is before 2 Mar and not a clock-time accident.
13. As a report reader, I want two date-and-time fields compared by full date and time, so that 1 Mar 14:30 is not equal to 1 Mar 09:00.
14. As a report editor, I want to compare a date-only field to a date-and-time field, so that I am not blocked when both appear in one report.
15. As a report reader, I want that mixed field compare to treat the date-only value as midnight, so that the rule is predictable.
16. As a report editor, I want to type `2026-03-01` in a formula, so that I can compare a field to a fixed date.
17. As a report editor, I want typed dates to use year-month-day, so that day/month order cannot be swapped.
18. As a report editor, I do not want a clock time in typed dates, so that typed dates stay simple.
19. As a report reader, I want `[Invoice.created_at] = 2026-03-01` to be Yes when created-at falls on that calendar day, so that a typed date is useful against date-and-time fields.
20. As a report editor, I want the same compare symbols on numbers, so that I can write `[Invoice.amount] > 1000`.
21. As a report editor, I want number equality to use the same decimal values as formula math, so that amount compares match other calculations.
22. As a report editor, I want to mix a compare with number math in one formula, so that I can write `([Invoice.invoice_date] = [Invoice.due_date]) * [Invoice.amount]`.
23. As a report editor, I want another formula to use a Yes/No column as 1 and 0, so that I can compose without re-typing the compare.
24. As a report editor, I want to pick Yes/No as a format, so that a pure compare displays words instead of 1 and 0.
25. As a report editor, I want Number, Currency, and Percentage to remain available, so that mixed amount formulas still format as money.
26. As a report reader, I want Yes and No in my locale, so that Hebrew reports show the same meaning as English.
27. As a report reader, I want a missing date to leave the cell blank, so that I do not see a false No.
28. As a report reader, I want an invalid compare (bad types, unreadable date) to stay blank, so that errors do not crash the report.
29. As a report reader, I want CSV and Excel to show Yes or No like the screen, so that exports match the viewer.
30. As a report reader, I want PDF and scheduled output to use the same formatted Yes/No, so that every channel matches.
31. As a report editor, I want grouped reports to SUM/AVG/MIN/MAX the 1/0 values, so that I can count matches per customer.
32. As a report reader, I want that grouped cell to show a number, so that a count of matches is not shown as Yes.
33. As a report editor, I want text, existing Yes/No report fields, and lists blocked from compares, so that the first version stays dates and numbers.
34. As a report editor, I want date vs number compares rejected on save, so that `[Invoice.invoice_date] = 1` cannot be stored.
35. As a report editor, I want adding or subtracting two dates rejected, so that date arithmetic is not implied by compare support.
36. As a report editor, I want a Help control in the formula editor, so that I can open help without leaving the dialog.
37. As a report editor, I want that help to list short rules and copy-paste examples, so that I can paste `[Invoice.invoice_date] = [Invoice.due_date]` and understand Yes/No.
38. As a report editor, I want help in English and Hebrew, so that both locales match the rest of the formula UI.
39. As a report editor, I want autocomplete to list date and date-and-time fields as well as numbers, so that I can insert them without typing.
40. As a report editor, I want live validation for unknown compare symbols and bad date literals, so that I fix the expression before save.
41. As a report owner, I want the server to evaluate compares the same way as the browser preview rules, so that saved reports cannot bypass type checks at run time.
42. As a platform owner, I want compares implemented in the existing formula engine without `eval`, so that expressions stay sandboxed.
43. As a platform owner, I want existing length, depth, and formula-count limits kept, so that compares do not add a new abuse surface.
44. As a report editor, I want existing arithmetic formulas unchanged, so that premium and fee columns keep working.
45. As a QA engineer, I want the invoice-date vs due-date path covered from builder to viewer and export, so that the original ticket is demoable without the later slices.

## Implementation Decisions

- Keep one formula engine (parse, validate, evaluate, format) as the only execution path. Mirror parser/validation on the client for the editor; do not add a second compare language.
- Add compare operators `= != < > <= >=` to the grammar. `!=` is the not-equal spelling (not `<>`).
- Compare operators bind **looser** than `+ − × ÷`. Mixing a compare with math requires parentheses, e.g. `([Invoice.invoice_date] = [Invoice.due_date]) * [Invoice.amount]`.
- A compare returns decimal `1` (Yes) or `0` (No) as the raw formula value. Chained formulas read that raw number.
- Add result format `yes_no` beside `number`, `currency`, and `percentage`. The editor must pick it; it is not inferred. Default for a new formula stays Number.
- `yes_no` formatting uses locale Yes/No (English and Hebrew). Invalid/missing stays blank (viewer em dash, export blank), same as other formula errors. Missing operands do not count as invalid-row warnings.
- CSV, Excel, PDF, and scheduled output use the formatted Yes/No string, not 1/0.
- On grouped reports, the editor still picks SUM/AVG/MIN/MAX. Aggregated group cells format as a **number** even when the formula format is Yes/No, because a count of matches is not Yes/No.
- Operand whitelist expands from numeric types to also include metadata types `date` and `datetime`. Text, boolean, and enum fields stay ineligible.
- Date-only (`date`) compares use UTC calendar days, matching how report date columns are displayed (`formatReportDate` uses UTC so date-only database values are not shifted).
- Date-and-time (`datetime`) compares use the stored instant (full date and time).
- Mixing a date-only **field** with a date-and-time **field** treats the date-only value as UTC midnight, then compares as date-and-time.
- Date literals are ISO `YYYY-MM-DD` only (no quotes, no clock time). The lexer must treat `2026-03-01` as one date token. Today that text would parse as subtraction (`2026 - 03 - 01`).
- Comparing a date-and-time field to a typed date uses **calendar day** (created-at on 1 Mar at 14:30 equals `2026-03-01`).
- Number compares use the same decimal values as arithmetic (exact `Prisma.Decimal` compare, not display rounding).
- Both sides of a compare must be the same family: date-like (date, datetime, date literal) or numeric (number fields, numeric literals, numeric/yes-no formula results). Date vs number is a validation error.
- Date-like values cannot use `+ − × ÷` with each other. After a compare yields 1/0, arithmetic on that number is allowed.
- Client draft validation and server execution validation must both reject illegal types, unknown operators, and malformed date literals. Persist the existing arithmetic safety limits (10 formulas, 500 characters, AST depth 10, no `eval`).
- Help: a Help control on the formula editor dialog opens a second dialog (reuse `AppDialog` and existing layout; no new theme styles). Content is short rules plus copy-paste examples covering the locked language. Translation keys live with other formula strings; do not edit translation files without explicit permission at implement time.
- No report database migration. Formulas stay in report JSON. Saved reports without compares keep working.
- Frontend and backend parser copies must stay in lockstep.

## Testing Decisions

- Prefer the existing report-execution seam (`tests/backend/api/report-formula-execution.test.ts` and related HTTP tests): a report config plus rows, then assert output keys, formatted cells, blanks, and warnings.
- Good tests assert observable behavior: accepted/rejected expressions, Yes/No (or 1/0 raw), calendar-day equality, datetime inequality on the same day, typed-date calendar-day match, number compare, mixed `(date = date) * amount`, grouped numeric aggregation, export formatted Yes/No.
- Do not couple tests to parser internals beyond grammar/safety cases that are hard to see through execution (ISO date token vs subtraction; prohibited tokens).
- Client prior art: `validateFormulaDraft` unit tests and formula modal/editor tests under `tests/frontend/unit/reports/`.
- Viewer/export prior art: `viewColumnGenerator` and ReportViewer export mapping of `___formatted_*`.
- Do not add or expand automated tests in implementation slices unless the user explicitly asks. Manual How to test on each slice is enough to demo.

## Out of Scope

- Text, boolean report fields, enums, and list compares.
- Clock time in typed literals (no `2026-03-01 14:30`).
- Date arithmetic (add days, date diffs) other than compare.
- Spreadsheet `<>` not-equal, `==` equality, or word operators (EQ, BEFORE).
- Filtering by formula results — tracked separately in `.cursor/plans/report-builder-formula-filters.prd.md` (after this PRD). Sorting or charting by formula results stays out of both (filter PRD is filter-only).
- Inferring Yes/No vs Number from the expression.
- Exporting 1/0 instead of Yes/No for spreadsheet math.
- A standalone docs route or first-time overlay; help only opens from the formula editor Help control.
- New global CSS, theme tokens, or feature-specific style hooks.
- Changing invoice date / due date report metadata semantics.
- Server-side save validation of the original arithmetic formula contract beyond what this work needs for compares (execution must still be safe). Full save-time formula validation remains a known gap from the original formula PRD unless a slice naturally extends the same validator.

## Further Notes

Original ticket: [Report Builder: compare date fields in formula columns](https://app.clickup.com/t/25708732/869ez1bd0). Base formula behavior lives in `.cursor/plans/report-builder-formula-fields.prd.md`.

Example for the original need:

`[Invoice.invoice_date] = [Invoice.due_date]` with format Yes/No.

Typed date must not be parsed as subtraction. Help should show `2026-03-01` as the only typed-date spelling.

### Decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | First version | Any date field, plus equal / not-equal / before / after |
| D2 | Date-only equality | Same calendar day; before/after by day |
| D3 | Cell display | Yes / No |
| D4 | Other formulas | Raw 1 (Yes) and 0 (No) |
| D5 | Field types | Date-only by day; date-and-time by full date and time |
| D6 | Mix date field + datetime field | Allowed; treat the date as midnight |
| D7 | Inclusive compares | Also on-or-before and on-or-after |
| D8 | Symbols | `= != < > <= >=` |
| D9 | Grouped reports | SUM/AVG/MIN/MAX on 1/0; group cell is a number |
| D10 | Mix in one formula | Allow `(date = date) * amount` |
| D11 | Typed dates | Allowed |
| D12 | Typed date spelling | `2026-03-01` |
| D13 | Typed clock time | Not in v1 |
| D14 | Datetime field vs typed date | Yes if that calendar day |
| D15 | Number compares | Allowed |
| D16 | Other types | Dates and numbers only |
| D17 | Help location | Page opened from the formula editor |
| D18 | How help opens | Help control in the formula editor |
| D20 | Help content | Short rules plus copy-paste examples |
| D21 | Export | CSV/Excel show Yes / No |
| D22 | Yes/No vs number format | Editor picks Yes/No as a fourth format |

Missing dates: blank, not No (ticket How to test + existing missing-operand behavior).

### Codebase scan

#### Required

- `reports/src/reports/report-formula/parser.ts` and `archaser-frontend/shared/reportFormula/parser.ts` — compare operators and ISO date tokens (keep copies in sync).
- `reports/src/reports/report-formula/formula-engine.ts` — evaluate compares; date vs datetime vs literal rules; 1/0 results.
- `reports/src/reports/report-formula/formula-execution.ts` — operand types include `date`/`datetime`; `yes_no` formatting; grouped aggregation still numeric.
- `reports/src/reports/report-formula/types.ts` and `archaser-frontend/shared/reportFormula/types.ts` — `FormulaResultFormat` includes `yes_no`.
- `reports/src/reports/report-datetime.util.ts` — reuse UTC calendar-day display rules for date-only compares.
- `archaser-frontend/shared/reportFormula/columnOrder.ts` — `isFormulaOperandFieldType` allows date/datetime.
- `archaser-frontend/shared/reportFormula/validateFormulaDraft.ts` — type families, date literals, new errors.
- `archaser-frontend/components/reports/FormulaUpsertModal.tsx` — format option Yes/No, operand insert includes dates, Help control, helper text.
- `archaser-frontend/components/reports/FormulaColumnEditor.tsx` — pass through format and operands.
- New help dialog opened from the formula modal (reuse `AppDialog`).
- `archaser-frontend/shared/utils/viewColumnGenerator.tsx` — render formatted Yes/No (or em dash).
- `archaser-frontend/components/reports/ReportViewer.tsx` — export still maps `___formatted_*` (Yes/No strings).
- PDF/scheduled paths that already execute formulas server-side — pick up `formatFormulaValue` without a separate compare exporter.
- `locales/en/reports.json` and `locales/he/reports.json` — Yes/No format, help copy, operand hints, validation messages (**implement only with translation permission**).

#### Optional / out of scope unless requested

- `reports.service.ts` create/update save-time formula validation (pre-existing gap for arithmetic formulas).
- Formula grouping execution if still incomplete for arithmetic formulas — this PRD does not rebuild grouping; it only defines how Yes/No aggregates should look when grouping runs.
- Report metadata (`Invoice.invoice_date`, `Invoice.due_date`) — already `type: "date"`; no new fields.
- Virtual numeric proxies `Invoice.days_overdue` / `Invoice.days_until_due` — already formula-eligible numbers; no change required for the date-compare path.
- Portfolio Health intro overlay — different pattern; do not reuse for formula help.

#### No change needed

- Prisma schema / report table migrations — config is JSON.
- Report permissions — existing report editor authorization.
- Credit-insurance gating for policy rate fields.
- Chart builder, formula sort, dashboards (formula **filter** is a follow-on PRD).
- `cost_percent` / `registration_fee_percent` auto-scale in arithmetic (unchanged).

### Suggest plan improvements

- Tokenizer is the easy-to-miss footgun: `2026-03-01` is subtraction today. Treat ISO dates as atomic tokens before unary/binary minus.
- Operand picker currently filters by format (currency/percentage). Yes/No should allow date and number operands; Currency mixed formulas still need amount fields.
- Helper text `formulas.expression_hint` and `no_operands_hint` still say numeric-only — update with translation permission or the editor will contradict help.
- Grouped Yes/No vs number formatting must be explicit in `formatFormulaValue` when an aggregated value is not 0/1.
- Frontend and backend parsers can drift; change them in the same slice.
- Styling: Help is an extra `AppDialog`; do not add new `sx` systems without approval.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/report-builder-formula-comparisons/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/report-builder-formula-comparisons/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Date equality Yes/No from builder to export | `issues/01-date-equality-yes-no.md` | — | 1–7, 11, 24–30, 39–45 |
| 2 | Date compare language (operators, datetime, literals) | `issues/02-date-compare-language.md` | #1 | 8–19, 40–41 |
| 3 | Number compares, mixed math, grouping | `issues/03-number-compare-and-grouping.md` | #2 | 20–23, 31–35 |
| 4 | Formula editor help page | `issues/04-formula-editor-help.md` | #3 | 36–38 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
