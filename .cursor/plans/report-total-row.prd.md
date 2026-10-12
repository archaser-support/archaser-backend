---
name: report-total-row
overview: Optional total row for builder reports — saved per report, shown fixed at the bottom of the viewer grid, and optionally included in CSV, Excel, PDF, and scheduled exports.
source: grill-me session (2026-10-12)
clickup_task_url: null
isProject: false
---

# Report total row

## Problem Statement

Report users want one line that totals the report. Today there is no total row. Columns with an aggregation show a number in the column header instead, and for SUM / AVG / MIN / MAX that number is computed in the browser from the rows loaded so far (20 per page), so on any report bigger than one page it is wrong. Exports have no totals at all, and grouped money totals take their currency from the first row, so mixed currencies are added together silently.

## Solution

Report editors turn on **Show total row** in the builder; it is saved on the report. The viewer shows a total row fixed at the bottom of the grid. Each column shows its own aggregation (SUM / AVG / COUNT / MIN / MAX) computed on the server over every row that matches the current filters and search; columns without an aggregation stay blank and the word "Total" goes in the first such column. Money columns that mix currencies show "—". When the total row is on, the header totals are hidden. The export dialog gets an **Include total row** checkbox that starts from the saved setting; CSV, Excel, and PDF append the totals as a last row of plain values. Scheduled/system exports follow the saved setting.

## User Stories

1. As a report editor, I want a "Show total row" toggle in the builder, so that the report opens with totals.
2. As a report editor, I want the toggle saved on the report, so that everyone sees the same layout.
3. As a report editor, I want the toggle greyed out with a hint when no column has an aggregation, so that I know why it is unavailable.
4. As a report reader, I want the total row fixed at the bottom of the grid, so that I see totals without scrolling through every row.
5. As a report reader, I want each column's total to use that column's aggregation, so that SUM columns are summed and AVG columns are averaged.
6. As a report reader, I want totals calculated over all rows that match my filters and search, so that they are correct beyond the first page.
7. As a report reader, I want totals to follow my session filter overrides, so that what I see is what is totaled.
8. As a report reader of a grouped report, I want AVG totals over the original rows, so that the overall average is not an average of averages.
9. As a report reader, I want formula columns with an aggregation to be totaled the same way, so that calculated money columns have totals.
10. As a report reader, I want a money total shown with its currency when all rows share one currency, so that the number is meaningful.
11. As a report reader, I want "—" when a money column mixes currencies, so that USD and ILS are never added together.
12. As a report reader, I want "Total" in the first column without an aggregation, so that the label never hides a number.
13. As a report reader, I want "Total: X" in the first cell when every column has an aggregation, so that the row is still labeled.
14. As a report reader, I want header totals hidden when the total row is on, so that I do not see two different numbers.
15. As a report reader, I want header totals unchanged when the total row is off, so that existing reports look the same.
16. As a report reader, I want an "Include total row" checkbox in the export dialog, starting from the report's setting, so that I can choose per export.
17. As a report reader, I want the checkbox only on report exports, so that other grids' export dialogs do not change.
18. As a report reader, I want the total as the last row in CSV and Excel with plain numbers, so that the file matches the screen.
19. As a report reader, I want money totals split into amount and currency columns like other rows, so that Excel can still sum the amount column.
20. As a report reader, I want PDF exports to include the total row when chosen, so that printed reports match.
21. As a report owner, I want scheduled/system exports to include the total row when the report setting is on, so that emailed files match the viewer.
22. As a report editor, I want existing reports to keep the total row off, so that nothing changes until I opt in.
23. As a Hebrew user, I want the total row label, hint, and checkbox in Hebrew and right-to-left, so that the feature works in both locales.
24. As a platform owner, I want totals computed only on the server, so that the grid, files, and schedules always agree.

## Implementation Decisions

- **Config:** add optional `showTotalRow?: boolean` to `report_config` (`frontend/types/reports.ts` and the Nest local `ReportConfig`). Missing = off. No Prisma migration.
- **Eligibility:** a report can show totals only when at least one field or formula has an aggregation. The server ignores the flag otherwise (covers old saved configs).
- **Execute contract:** request flag `includeTotals?: boolean` on `ExecuteReportDto`. Response adds `totals` only when requested and eligible:
  - `totals.cells[outputKey] = { value: number | null, currency?: string, mixedCurrency?: boolean, formatted?: string }`
  - `totals.labelKey` = output key of the column that carries the "Total" label, or `null` when every column is aggregated (the client renders "Total: X" in the first cell).
  - The viewer requests totals on page 1 only (same pattern as `aggregationTotals`).
- **Computation:** totals run over the full filtered set (scope + filters + session overrides + search + formula filters), **before** grouping, using `calculateAggregation` from `report-grouping.util.ts`. For COUNT, count non-null values. Reuse the same function for formulas with an aggregation.
- **Currency:** per money column, resolve each row's currency with the existing row resolution (`resolveCurrencyFromRow` rules). One currency → value + currency + `formatMoneyIso`. More than one → `mixedCurrency: true`, `value: null`. COUNT has no currency.
- **Label placement:** first column in the resolved column order (`columnOrder`, falling back to fields order) that has no aggregation. Shared helper used by grid and export.
- **Grid:** new fixed footer row in `EndlessScrollDataGrid` (opt-in prop, so other grids are unaffected), reusing `DataGridRow` cell layout, column widths, resizing, horizontal scroll sync, and RTL. **New styling needs explicit approval** before implementation.
- **Header totals:** `generateViewColumns` / `getAggregationLabelSuffix` receive the flag and omit the number when the total row is on. Behavior when off is unchanged (known partial-data bug stays).
- **Builder:** toggle in the Grouping step (aggregations live next to grouping), greyed out with a hint when no aggregation exists.
- **Export dialog:** `ExportDialog` gets an optional `includeTotalRow` control (props: `totalRowAvailable`, `defaultIncludeTotalRow`). Shown only when the caller passes it (report viewer). `onExport` receives the choice.
- **Viewer CSV / Excel:** the export execute (limit 10000) sends `includeTotals` when checked; append the total row last, with "Total" in `labelKey`, before `exportToExcel` so the existing money/currency split applies. Mixed → empty cell.
- **System / scheduled export:** `InternalReportsController.export` executes with `includeTotals` from `config.showTotalRow`; `buildReportExport` accepts optional totals and appends the row before `applyMoneyCurrencySplit`. Label text from a small server map by user language (`Total` / `סה״כ`).
- **PDF:** the viewer PDF path is broken today (viewer sends `GET`, Nest only has `POST /:id/export`, which returns JSON instead of a file). Recommended: build the viewer PDF in the browser through `exportToExcel`'s jsPDF path from the same rows + total row, and drop the broken `GET` call. System PDF keeps today's CSV fallback, with the total row. **Confirm before implementation.**
- **i18n (EN + HE):** `reports.fields.show_total_row`, `reports.tooltips.total_row_requires_aggregation`, `reports.values.total`, `common` export checkbox label `fields.include_total_row`.
- **Docs:** fold the final rules into `docs/agents/reports.md` (config, execute response, viewer, export) when this ships, then delete this PRD.

## Gates

| Gate | Blocking | If yes | If no |
| --- | --- | --- | --- |
| Can ungrouped, SQL-paged reports get totals from a Prisma `aggregate` alongside the page (plain numeric columns only)? | Backend slice | Keep SQL paging; aggregate query for totals | **No — use full fetch.** Prisma `_sum` / `_avg` / `_min` / `_max` / `_count` cannot honor per-row `resolveCurrencyFromRow` (mixed currencies would be added silently), COUNT of non-null formatted values, or joined scalars. Aggregations already set `needsGroupedExecution` → full fetch, so `includeTotals` stays on that path and `buildReportTotalsCells` runs over the formatted detail rows. |
| Columns that are computed / enriched / formula (not Prisma columns) | Backend slice | — | **Always need a full fetch** (same path as today: no SQL skip/take, no row cap). Cost is the whole filtered set in memory, then `formatRow` / formulas / `calculateAggregation`. A Prisma `aggregate` has no scalar for these columns. |
| PDF approach (above) approved? | PDF slice | Client jsPDF with total row | Fix the Nest export route to return a PDF file first (separate work) |

## Testing Decisions

- Highest seam: report execute with `includeTotals` — config in, `totals` out. Assert: totals over all pages (not page 1), filters/search respected, grouped AVG over original rows, mixed currency → `mixedCurrency`, single currency formatted, no aggregation → no `totals`, `labelKey` placement.
- Export seam: `buildReportExport` with totals → last CSV row values and money split.
- Prior art: `tests/backend/api/report-formula-execution.test.ts`, report execute/export HTTP tests.
- Do not add or expand automated tests unless the user explicitly asks; each slice carries a manual **How to test**.

## Out of Scope

- Fixing header totals when the total row is off.
- Currency conversion via `CurrencyRate`.
- Per-group subtotal rows.
- A separate per-column "total function" independent of aggregation.
- Excel live formulas (`=SUM`).
- Totals on non-report grids (customers, invoices, dashboards using `ViewBasedDataGrid`) — the footer prop allows it later.
- Fixing chart data (`chartData` not returned).

## Further Notes

Module reference: `docs/agents/reports.md`.

### Decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | Control | Builder saves "Show total row"; export dialog checkbox defaults to it |
| D2 | Cell values | Each column's own aggregation; others blank |
| D3 | Grouped reports | Totals over original rows (true AVG) |
| D4 | Mixed currencies | "—" when mixed; total + currency when single |
| D5 | Grid placement | Fixed at bottom, always visible |
| D6 | Header totals | Hidden when total row on; unchanged when off |
| D7 | Export paths | Excel, CSV, PDF (checkbox) + scheduled/system (saved setting) |
| D8 | File format | Last row, plain server values, same money split |
| D9 | No aggregations | Toggle greyed out with hint; export checkbox hidden |
| D10 | Label | First non-aggregated column; else "Total: X" in first cell |
| D11 | Totals fetch (gate) | Prisma `aggregate` is not sufficient. Requesting totals uses the existing aggregation full-fetch (all matching rows in memory). Computed / enriched / formula columns always need that path; even plain money needs formatted rows for currency. |

### Example

Columns (in order): Customer | Amount (SUM) | Days overdue (AVG) | Invoice #. Filter: status = Open. 3,200 rows, all USD.
Grid footer: `Total | USD 1,240,000 | 19 | ` — same on every scroll position. Excel last row: `Total | 1240000 | USD | 19 | `.

### Codebase scan

#### Required

- `frontend/types/reports.ts`, Nest `ReportConfig` (execution service) — `showTotalRow`.
- `reports/src/reports/dto/execute-report.dto.ts` — `includeTotals`.
- `reports/src/reports/report-execution.service.ts` — compute totals pre-grouping over the full filtered set; full-fetch rule when totals are requested (per gate).
- `reports/src/reports/report-grouping.util.ts` — totals helper reusing `calculateAggregation` + currency resolution.
- `reports/src/internal/internal-reports.controller.ts`, `reports/src/reports/report-export.util.ts` — totals in system exports.
- `frontend/components/reports/GroupingBuilder.tsx` (or builder page) — toggle + hint.
- `frontend/components/reports/ReportViewer.tsx` — request totals, pass to grid, export with totals, PDF path.
- `frontend/shared/layout-components/grid/hooks/useVirtualInfiniteScroll.ts`, `types.ts` — carry `totals`.
- `frontend/shared/layout-components/grid/EndlessScrollDataGrid.tsx` (+ new footer row component) — fixed total row.
- `frontend/shared/utils/viewColumnGenerator.tsx`, `shared/utils/reportAggregationHelpers.ts` — hide header totals when on.
- `frontend/shared/layout-components/grid/ExportDialog.tsx`, `hooks/useExport.ts` — optional checkbox, pass choice.
- `frontend/shared/utility/exportToExcel.ts` — total row in CSV/Excel/PDF.
- `frontend/locales/{en,he}/reports.json`, `locales/{en,he}/common.json` — new strings.
- `docs/agents/reports.md` — update on ship.

#### Optional / out of scope unless requested

- `shared/components/ViewBasedDataGrid/ViewBasedDataGrid.tsx`, `shared/hooks/useViewExecution.ts` — context grids could adopt the footer later.
- `reports/src/reports/reports.controller.ts` `POST /:id/export` — could accept `includeTotals` if PDF moves server-side.
- Unit tests for the totals helper and export append.

#### No change needed

- Prisma schema (config is JSON).
- Formula parser / engine.
- Report scope / permissions (totals reuse execute scope; export keeps `export_report`).
- Report metadata / relationships.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/report-total-row/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**. Covers the **builder and report viewer**; export slices (user stories 16–21) are not published yet.

**Overview:** `.cursor/plans/report-total-row/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Builder toggle and viewer total row (ungrouped, single currency) | `issues/01-builder-toggle-and-viewer-total-row.md` | — | 1–7, 12, 22–24 |
| 2 | Totals for grouped reports and formula columns | `issues/02-grouped-reports-and-formulas.md` | #1 | 8, 9 |
| 3 | Mixed currencies and "Total: X" label | `issues/03-mixed-currency-and-label-edge-cases.md` | #1 | 10, 11, 13 |
| 4 | Hide header totals when the total row is on | `issues/04-hide-header-totals-when-on.md` | #1 | 14, 15 |

**Status:** `ready-for-agent` on all slices.

*Soft ordering:* #2, #3 and #4 can run in parallel after #1.
