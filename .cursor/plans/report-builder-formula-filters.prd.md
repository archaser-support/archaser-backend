---
name: report-builder-formula-filters
overview: Let Report Builder and Report Viewer filter ungrouped reports by formula column results (including Yes/No), with correct pagination after formula evaluation.
source: grill-me session (2026-09-09) following report-builder-formula-comparisons
clickup_task_url: null
isProject: false
---

# Report Builder formula filters

## Problem Statement

Report editors can build formula columns (amounts, percentages, and Yes/No compares such as invoice date equals due date), but they cannot filter the report to those results. Filters only apply to database fields before rows are loaded. Formulas run afterward on the current page, so “show only Yes” or “premium greater than 1000” cannot be expressed as a real report filter. Viewers, exports, and schedules therefore cannot narrow to formula outcomes either.

## Solution

After formula comparisons ship, allow filters on every formula defined on the report. Editors set them in the builder; viewers can change them for the session, same as normal filters. Number, Currency, and Percentage formulas use the same number-style operators as amount filters. Yes/No formulas use a Yes/No value control and only equals / not equals / empty / not empty. When any formula filter is present, the server loads rows that match database filters, evaluates formulas, keeps matching rows, then paginates so totals are correct. The same filtered set is used for view, CSV/Excel, PDF, and scheduled output. Formula filters apply only to ungrouped reports; combining them with grouping is blocked with a clear error. Sorting by formula stays out of this work.

## User Stories

1. As a report editor, I want to pick a formula column in the filter builder, so that I can narrow the report by a calculated result.
2. As a report editor, I want every formula on the report available as a filter field even if its column is hidden, so that I can filter without forcing the column on screen.
3. As a report viewer, I want to change formula filters for my session, so that I can explore without editing the saved report.
4. As a report editor, I want formula filters saved on the report config, so that everyone opens the report already narrowed.
5. As a report editor, I want number formulas to support equals, not equals, greater than, less than, greater or equal, less or equal, is empty, and is not empty, so that amount logic matches other number fields.
6. As a report editor, I want currency formulas to use those same number operators, so that money formulas filter like amount columns.
7. As a report editor, I want percentage formulas to use those same number operators, so that rate formulas filter consistently.
8. As a report editor, I want to enter percentage filter values as the raw fraction (0.15 for 15%), so that the filter matches formula math and display formatting.
9. As a report editor, I want Yes/No formulas to offer a Yes/No value picker, so that I do not have to type 1 or 0.
10. As a report editor, I want Yes and No in my locale in that picker, so that Hebrew and English match the column labels.
11. As a report editor, I want Yes/No formula filters limited to equals, not equals, is empty, and is not empty, so that “greater than Yes” is not offered.
12. As a report reader, I want equals Yes to keep rows whose formula raw value is 1, so that same-day compares can be filtered.
13. As a report reader, I want equals No to keep rows whose formula raw value is 0, so that mismatches can be filtered.
14. As a report reader, I want a blank formula cell not to match equals Yes or equals No, so that missing dates are not treated as No.
15. As a report reader, I want is empty / is not empty on formulas to match blank vs non-blank results, so that I can find incomplete calculates.
16. As a report reader, I want normal database filters to still apply first, so that formula filters only run on the already narrowed set.
17. As a report reader, I want page totals and page contents to reflect formula filters, so that page 1 is not “first N DB rows that happen to match after formulas.”
18. As a report reader, I want CSV export to honor formula filters, so that downloads match the viewer.
19. As a report reader, I want Excel export to honor formula filters, so that spreadsheets match the viewer.
20. As a report reader, I want PDF output to honor formula filters, so that printed reports match the viewer.
21. As a report owner, I want scheduled report runs to honor saved formula filters, so that emailed reports stay narrowed.
22. As a report editor, I want formula filters blocked when the report uses grouping, so that I am not given a silent wrong answer.
23. As a report editor, I want a clear error if I try to save grouping together with a formula filter, so that I know what to remove.
24. As a report viewer, I want a clear error if I try to run a grouped report with a formula filter override, so that execute does not silently ignore the filter.
25. As a report editor, I want a clear error if a filter points at a deleted formula, so that a broken filter is not silently skipped.
26. As a report editor, I want save blocked while an orphan formula filter remains, so that bad config cannot be stored unnoticed.
27. As a report reader, I want execute blocked while an orphan formula filter remains, so that stale session filters fail loudly.
28. As a report editor, I want filters to store the stable formula id, so that renaming the formula label does not break the filter.
29. As a report editor, I want the filter field list to show the formula label, so that I can recognize the column.
30. As a platform owner, I want formula filters applied only after formula evaluation on the server, so that clients cannot fake filtered totals.
31. As a platform owner, I want unknown non-formula filter fields to keep today’s behavior, so that this work does not rewrite all filter eligibility.
32. As a report editor, I want existing non-formula filters unchanged, so that invoice and customer filters keep working.
33. As a QA engineer, I want a Yes/No formula filter path covered from builder save through viewer and export, so that the main compare-filter story is demoable.
34. As a QA engineer, I want a number formula greater-than filter covered with correct totalRecords after pagination, so that the compute-then-filter path is proven.
35. As a report owner, I want this feature to wait until Yes/No formula format exists, so that date-compare filters and number filters ship as one coherent filter story.
36. As a report editor, I do not need formula sort in this release, so that scope stays on filtering.
37. As a report editor, I do not need to filter on aggregated group formula totals in this release, so that HAVING-style work stays later.
38. As a report reader, I want multiple formula filters combined with other filters the same way today’s filter list combines (all must match), so that behavior is predictable.
39. As a report editor, I want helper or validation copy for percentage raw values when needed, so that 15 vs 0.15 confusion is reduced.
40. As a platform owner, I want EN and HE strings for new filter labels and errors shipped together, so that locales stay in lockstep.

## Implementation Decisions

- Ship as a **separate PRD** after `report-builder-formula-comparisons` (Yes/No format and date compares). Do not fold into the comparisons slices.
- Filter identity uses the stable formula output key (`formula:<id>`). Display uses the formula label. Renaming the label does not change the stored filter.
- Every formula on `config.formulas` is eligible in builder and viewer filter pickers, including formulas whose columns are hidden.
- Split filter application: database-backed filters still become Prisma `WHERE`; formula-targeted filters are applied in memory **after** `applyFormulasToRows` and **before** pagination slicing for the response.
- When **any** formula filter is present on an ungrouped execute/export: fetch all rows matching scope + database filters (+ search as today), format, evaluate formulas, apply formula filters, then paginate and set `totalRecords` from the post-formula set. No extra hard row cap in v1.
- Viewer session overrides continue to use the existing replace-config-filters execute contract; formula filters are valid members of that filter list.
- Number / Currency / Percentage formulas: same operator set as number/decimal amount filters. Compare against the **raw** numeric formula value (not the formatted string). Percentage values are fractions (0.15 means 15%), matching formula math and percent formatting.
- Yes/No formulas: value UI is a Yes/No control (locale labels); stored/compared as 1 / 0. Operators: equals, not equals, is empty, is not empty only.
- Blank / missing / invalid formula results: same as numbers — match only is empty / is not empty; never treat blank as No (0) for equals/not-equals or other compares.
- Grouping: formula filters are supported only on ungrouped reports. Saving or executing with both grouping and at least one formula filter returns a clear validation error (builder and server).
- Orphan formula filters (id not in `config.formulas`): clear validation error on save and on execute/export — do **not** silently drop like unmapped computed fields.
- Exports and scheduled runs use the same execute filtering path as interactive view.
- No Prisma schema migration; filters remain in report JSON alongside existing filter rows.
- i18n: new or changed user-facing strings (picker labels, Yes/No filter values if not reused, grouping conflict, orphan formula, percentage hints, validation) ship in **English and Hebrew** together.
- Reuse existing FilterBuilder patterns and report execute pipeline; do not add a second client-only filter engine for formula results.
- Styling: reuse existing filter UI and dialogs; no new global theme hooks without explicit approval.

## Testing Decisions

- Prefer the highest existing seam: **report execute (and export) HTTP / service behavior** with a report config that includes formulas + formula filters, asserting returned rows, `totalRecords`, and that page slices are taken after formula filtering.
- Prior art: `tests/backend/api/report-formula-execution.test.ts` for formula application; report execute/export HTTP tests for filters and pagination; frontend `FilterBuilder` unit tests for operator/field lists and value controls.
- Good tests assert observable outcomes: formula field appears in picker; Yes/No ops subset; blank does not match equals Yes; number greater-than keeps correct rows; totalRecords reflects post-formula count across pages; export body matches filtered set; grouping + formula filter rejected; orphan formula id rejected; percentage compare uses raw fraction.
- Do not couple tests to internal “split filter” helper names unless behavior cannot be seen through execute.
- Do not add or expand automated tests in implementation slices unless the user explicitly asks. Manual How to test on each `/to-issues` slice is enough unless requested otherwise.

**Primary test seam (confirm if this matches your expectation):** one execute/export path — config with formula filters in, filtered page + total out. UI coverage is secondary (FilterBuilder lists formulas and Yes/No value control).

## Out of Scope

- Sorting by formula columns (remains blocked / separate later work).
- Filtering on aggregated formula values after grouping (HAVING-style).
- Applying formula filters as silent pre-group row filters while grouping is on.
- Hard maximum row count / refuse-to-run cap for the compute-then-filter path.
- Best-effort filter of only the current database page (wrong totals).
- Charting or dashboard widgets filtered by formula results.
- Text/boolean/enum compares inside formulas (owned by other PRDs).
- Inferring operators or formats from the expression.
- New global CSS, theme tokens, or feature-specific style hooks.
- Changing how non-formula filters map to Prisma.
- Implementing formula comparisons / Yes/No format (prerequisite PRD).

## Further Notes

Depends on `.cursor/plans/report-builder-formula-comparisons.prd.md` for Yes/No format and date-compare formulas. Base formula columns: `.cursor/plans/report-builder-formula-fields.prd.md`.

### Decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | First version | Any formula; number-style operators for Number/Currency/% |
| D2 | Where | Builder and viewer |
| D3 | Blanks | Same as numbers; empty ops only |
| D4 | Grouping | Ungrouped reports only |
| D5 | Formula filter + grouping | Block save/run with clear error |
| D6 | Yes/No value | Yes/No dropdown; store 1/0 |
| D7 | Yes/No operators | equals, not equals, empty, not empty |
| D8 | Pagination | Compute → filter → paginate; no row cap |
| D9 | Picker | Every formula on the report |
| D10 | Export / schedule | Same as view |
| D11 | Deleted formula | Block save/run |
| D12 | Packaging | Separate PRD after comparisons |
| D13 | Percentage values | Raw fraction |
| D14 | Sort | Out of scope |

### Example

Formula `[Invoice.invoice_date] = [Invoice.due_date]` with format Yes/No. Filter: that formula equals Yes. Report shows only same-calendar-day rows, with correct totals, including CSV/scheduled output.

### Codebase scan (summary)

#### Required

- Report execute pipeline: detect formula filters; defer them past formula evaluation; paginate after.
- Filter DTO / config validation: formula field keys, orphan checks, grouping conflict.
- FilterBuilder (builder + viewer): list formulas; operator sets by formula format; Yes/No value control; percentage as number input on raw scale.
- Report save validation aligned with execute rules for orphan + grouping conflict.
- Export and schedule paths that call execute — inherit behavior.
- EN/HE locale keys for new copy.

#### Optional / out of scope unless requested

- Formula sort using the same full-fetch path.
- Soft UX warning that formula filters may be slower on large tenants.
- Save-time validation of formula expressions themselves (pre-existing gap).

#### No change needed

- Prisma report table schema.
- Formula parser/engine grammar (owned by comparisons / base formula PRDs).
- Credit-insurance gating and report permissions model.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/report-builder-formula-filters/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**. **Prerequisite:** formula comparisons / Yes/No format must already ship.

**Overview:** `.cursor/plans/report-builder-formula-filters/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Yes/No formula filter from builder to export | `issues/01-yes-no-formula-filter-e2e.md` | — | 1–4, 9–18, 20–21, 28–33, 35, 38, 40 |
| 2 | Number, currency, and percentage formula filters | `issues/02-number-currency-percentage-filters.md` | #1 | 5–8, 34, 39, 40 |
| 3 | Grouping conflict and orphan formula filter guards | `issues/03-grouping-and-orphan-guards.md` | #1 | 22–27, 40 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.

*Soft ordering:* #2 and #3 can proceed in parallel after #1.
