# Reports module — how it works today

Single reference for the report builder, viewer, execution, dashboard report lists, and export. Describes **current behavior** (verified against code, 2026-10-12). Older per-feature PRDs and plans were merged here and removed; their text is in git history.

**Upkeep rule:** a new report feature gets its own PRD under `.cursor/plans/` while it is being built. When it ships, fold the final rules into the matching section here and delete the PRD and its slices in the same PR. When this file and the code disagree, the code wins — fix this file.

**Open PRDs:** `.cursor/plans/report-total-row.prd.md` (total row — planned).

---

## 1. Where things live

| Area | Backend (`reports/src/`) | Frontend |
| --- | --- | --- |
| HTTP | `reports/reports.controller.ts`, `internal/internal-reports.controller.ts` | No Next API handlers — `/api/reports*` is rewritten to the Nest reports service (`nest-api-rewrite.cjs`, env key `REPORTS_NEST_REWRITE_TARGET`, default port `REPORTS_PORT` 3006). Amplify uses `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_NEST_API_BASE_URL`. |
| CRUD / metadata | `reports/reports.service.ts` | `app/[locale]/app/reports/` (list, `builder/`, `[id]/`) |
| Execute | `reports/report-execution.service.ts` | `components/reports/ReportViewer.tsx`; context grids via `shared/components/ViewBasedDataGrid/ViewBasedDataGrid.tsx` + `shared/hooks/useViewExecution.ts` |
| Config types | local `ReportConfig` in execution service | `types/reports.ts` (canonical) |
| Grain / keys / contexts | `reports/report.constants.ts` | `utils/reportTableUtils.ts`, `shared/utils/viewConfigs.ts` |
| Filters / dates | `report-filter.util.ts`, `date-preset.util.ts` | `components/reports/FilterBuilder.tsx`, `utils/datePresetUtils.ts` |
| Dashboard markers | `dashboard-activity-markers.util.ts`, `dashboard-credit-customer-markers.util.ts`, `dashboard-credit-invoice-markers.util.ts` | `creditDashboardReportFilters.ts`, dashboard detail pages |
| Scope | `report-scope.util.ts`, `@archaser/auth` | — |
| Grouping / aggregation | `report-grouping.util.ts` | `components/reports/GroupingBuilder.tsx`, `shared/utils/reportAggregationHelpers.ts` |
| Formulas | `report-formula/*`, `report-formula-filter.util.ts` | `shared/reportFormula/*`, `FormulaColumnEditor.tsx`, `FormulaUpsertModal.tsx`, `FormulaHelpDialog.tsx` |
| Metadata | `report-metadata.ts`, `report-relationships.ts`, `report-virtual-fields.util.ts`, `report-customer-trend-fields.util.ts`, `report-link.util.ts` | `DragDropFieldSelector.tsx`, `TableCanvas.tsx` |
| Formatting | `format-money.util.ts`, `report-datetime.util.ts` | `shared/utils/viewColumnGenerator.tsx` |
| Export | `report-export.util.ts` | `shared/layout-components/grid/{ExportDialog.tsx,hooks/useExport.ts}`, `shared/utility/exportToExcel.ts` |
| Repair scripts | `scripts/database/repair-report-primary-table.ts` | — |

---

## 2. Data model

**`Report`** (Prisma): `name`, `unique_name` (unique per account), `description`, `report_config` (JSON), `context`, `is_system`, `is_default`, `is_public`, audit fields. Related: `ReportShare` (user or role, `view` / `edit`), `ReportSchedule`, `ReportExecution` (not written by the reports service today), `UserDefaultReport` (per user per context).

- Visibility of definitions = same `account_id` only. `is_public` and shares are stored but **do not** filter list/get/execute.
- System reports are per-account copies. Master account **10013** owns the catalog; `POST /api/reports/sync-system` pushes them to other accounts. Non-admins cannot edit system reports; only non-system reports can be deleted. System report names are stored in English (not translated).

**`report_config`** (`types/reports.ts`) — JSON only, no Prisma migration for config changes:

| Key | Used by execute | Notes |
| --- | --- | --- |
| `tables`, `primaryTable` | Yes | See §6 Grain |
| `fields[]` `{table, field, alias?, aggregation?}` | Yes | Output key via `getFieldOutputKey` (alias, `Table.field`, or `Table.field__AGG`) |
| `filters[]` | Yes | Merged with execute body unless `replaceConfigFilters` |
| `sorting[]` `{field, direction}` | Yes | Fallback when the request has no sort |
| `grouping[]` | Yes | Output keys of non-aggregated fields |
| `formulas[]` | Yes | See §9 |
| `columnOrder[]` | No (UI only) | Interleaves field keys and `formula:{id}` |
| `chart` | No (UI only) | Builder chart step is a placeholder; `ChartConfigurator.tsx` is not wired |
| `joins[]` | No | Execute uses metadata relationships |

---

## 3. Endpoints

Public — `api/reports`, `DualAuthGuard` (Nest JWT or NextAuth cookie; view-as via cookie / `X-Archaser-View-As-*`):

| Route | Purpose |
| --- | --- |
| `GET /` | List (page max 100); `?default=true&context=` resolves the default view |
| `POST /`, `PUT /:id`, `DELETE /:id`, `GET /:id` | CRUD |
| `GET /metadata` | Tables + relationships (drops `CustomerPolicy` without credit insurance) |
| `GET/POST/DELETE /user-default` | Per-user default per context |
| `POST /sync-system` | Admin: push system reports |
| `POST /:id/execute` | Grid data (§7) |
| `POST /:id/export` | Re-executes (limit 5000) and returns **JSON rows**, not a file |
| `GET/POST /:id/share`, `GET/POST /:id/schedule` | Shares / schedules |

Internal — `internal/reports`, `InternalSecretGuard` (header `x-internal-service-secret`): `POST /:id/execute` (runs as the first active user by role ladder `System_Administrator` → … → `Data_Analyst`), `POST /:id/export` → `buildReportExport` → base64 file payload.

---

## 4. Permissions and scope

- Permissions: `view_reports` (menu, list, execute), `manage_reports`. UI permissions: `create_report`, `edit_report`, `delete_report`, `share_report`, `export_report`. List clone uses `edit_report`; viewer clone uses `create_report`. The builder page has no frontend permission gate.
- Context grids may list/execute with the matching entity or dashboard permission instead of `view_reports` (`view_customers`, `view_contacts`, `view_financial_dashboard`, `view_operation_dashboard`, `view_credit_dashboard`) — `assertListPermission` / `assertExecutePermission`.
- Row scope (`buildScopeWhere`): account (Contact via Company→Customer; Dispute / CustomerCollectionPeriod / CustomerPolicy via Customer; InvoicePayment via Invoice), owner / view-as, user business unit + optional `businessUnitId` hierarchy, optional `selectedUserId` (Customer owner; Invoice via Customer; Activity creator or owner — skipped when an activity identity marker is present).
- Credit insurance gate: `CustomerPolicy` table and relationships are hidden from metadata without `account.has_credit_insurance`; executing a `CustomerPolicy`-grain report without it is rejected.

---

## 5. Contexts

`context` decides where a report appears and can force the grain (`CONTEXT_PRIMARY_TABLE` in `report.constants.ts`).

| Context | Grain | Surface |
| --- | --- | --- |
| `reports` (`MAIN_REPORTS_MENU_CONTEXT`) | from config | Main Reports menu |
| `customers`, `invoices`, `contacts`, `disputes`, … | entity | Entity list grids |
| `customer_*` tabs (e.g. `customer_unpaid_invoices`) | Invoice / … | Customer detail tabs |
| `dashboard_customers` / `dashboard_invoices` / `dashboard_payments` | Customer / Invoice / InvoicePayment | Financial dashboard chart details |
| `dashboard_activities` / `dashboard_disputes` / `dashboard_promises` | Activity / Dispute / CustomerCollectionPeriod | Operation dashboard KPI details |
| `dashboard_credit_customers` / `dashboard_credit_invoices` | Customer / Invoice | Credit dashboard + portfolio health drill-downs |

Dashboard contexts never appear in the main Reports menu. Builder save redirects back by context (customers, disputes, invoices, chart details, operation dashboard with drill params preserved via `dashboardOperationBuilderReturn`, `customer_*` tabs, else report details).

---

## 6. Grain (primary table) and relationships

**Why it exists:** grain used to be implicit (`tables[0]` / first column), so reordering columns flipped a Customer report into an Invoice report and blanked dates.

- Resolution (identical FE `resolveReportPrimaryTable` and BE): `CONTEXT_PRIMARY_TABLE[context]` → `config.primaryTable` → `config.tables[0]` → `"Customer"`. Column order never changes grain.
- `normalizeReportConfigPrimaryTables` / `syncReportTablesWithPrimary` keep `tables[0] === primaryTable` for legacy readers. Removing the primary table picks the first remaining table; new reports set primary when the first **table** is added.
- Builder: `TableCanvas` shows a primary chip and "Set as primary" (`labels.primary_table`, `actions.set_as_primary`).
- Repair: `scripts/database/repair-report-primary-table.ts` (dry-run / apply; backfills from `tables[0]`; Invoice heuristic only with `--prefer-invoice-when-dates`). Never repaired silently on execute.
- **Scalar from a to-many relation** (e.g. Customer report showing an Invoice date, without aggregation): every Prisma list relation is selected as a sample — `{ take: 1, orderBy: { id: "asc" } }` — and `unwrapRelationSample` uses the first row. Customer→CustomerPolicy also filters `is_active: true`. Rows are not exploded.
- **Aggregations over to-many** use `detectOneToManyRelationTable` + `expandRowsForGrouping` (one formatted row per child, then group).
- Filters on to-many relations become `{ some: where }`; the nested select applies the same `where` so displayed children match.

---

## 7. Execute pipeline (`ReportExecutionService.execute`)

1. Resolve user and account; load report; check permission.
2. Merge formula operand fields into the select (`mergeFormulaOperandFieldsIntoConfig`).
3. Resolve grain; page defaults `page=1`, `limit=20`, hard cap **10000**.
4. Merge filters; run dashboard marker expanders (§8).
5. Build scope; normalize filters (e.g. Dispute `assigned_to` → `owner_id`); reject orphan formula filters (`ORPHAN_FORMULA_FILTER`).
6. Split filters: database filters → Prisma `where`; formula filters and Customer fee-rate filters → in memory later. **Any filter whose field starts with `__` is dropped before Prisma** (`report-filter.util.ts`) — markers must be expanded in step 4 or they do nothing.
7. Search (`buildSearchWhere`: customer name/number, invoice number, contact email, `customer_number_policy`, …).
8. **Full fetch vs paging:** full fetch (no SQL skip/take, no row cap) when sorting needs memory (computed / enriched / policy-backed fields), formula filters, fee-rate filters, or grouping/aggregation. Otherwise SQL paging + `count`.
9. Post-fetch: credit-invoice pool root attribution (`attributePrismaInvoiceCustomersToCreditPoolRoots` — child-pool invoices shown under the pool root), fee-rate filters, credit dashboard enrichment, enriched sort.
10. `formatRow` (or `expandRowsForGrouping`) → value under the output key, `___formatted_<key>` display string, `__link_<key>` link metadata, linking ids (`id`, `Table.id`, `customer_id`).
11. `applyFormulasToRows` → formula filters on **detail rows** → grouping + aggregation → `aggregationTotals` (COUNT columns only, summed across groups) → sort → page.

Response: `{ data, totalRecords, aggregationTotals?, formulaWarnings? }`. No `chartData` is returned.

Special path: the `top_up_expiring` credit report uses `fetchTopUpExpiringReportAsCustomerRows` (up to 100,000 rows when formula filters are present).

---

## 8. Dashboard report lists

Dashboard drill-downs open a report list (saved view with columns, export, report selector) instead of a fixed grid. Exact KPI parity comes from **locked filters** the page passes as `additionalFilters` (AND-merged by `useViewExecution`) plus **marker filters** (field names starting with `__`) that the server expands into real `where` clauses.

### Marker expanders that exist on the server

| Expander | Markers | Injects |
| --- | --- | --- |
| `prepareDashboardActivityMarkers` | `__dashboard_activity_identity` (`agents_excl_audit` \| `all_agents_incl_audit` \| `system` \| `portal`), `__dashboard_total_calls` | `created_by` identity sets; total-calls OR (`Call` / `Promise_to_pay` / dispute title contains "filed") |
| `prepareDashboardCreditCustomerMarkers` | `__credit_dashboard_customer_scope` (policy id or `all`), `__credit_dashboard_customer_membership` | Policy-scoped customer `where` + membership ids from the credit domain services |
| `prepareDashboardCreditInvoiceMarkers` | `__credit_dashboard_invoice_membership` (`terms` \| `terms:…` \| `reporting` \| `reported`) | Terms / reporting / reported `where`; absorbs sibling `policy_id` / `customer_id` filters |

Membership value encoding: type, then optional parts — `:0` = exclude no-policy exposure (default include when omitted), `withinDays` (top_up_expiring), `utilization_bin:<bin>:<from>:<to>`, period types `type:from:to`. Credit dates: `fromDate` / `toDate` preferred; legacy single `asOfDate` still accepted. Both feed enrichment and membership.

### Financial dashboard (`dashboard_customers` / `_invoices` / `_payments`)

System reports: `dashboard_customers_overdue` (default), `dashboard_customers_active_dynamics`; `dashboard_invoices_overdue` (default), `_aging`, `_due`, `_maturity`; `dashboard_payments_collected_mtd`. Seeds: `create-dashboard-*-reports.sql`. Filters are mostly plain; active dynamics uses the `__dashboard_active_dynamics` marker (period `YYYY-MM`).

### Operation dashboard (`dashboard_activities` / `_disputes` / `_promises`)

- One system report each: `dashboard_activities_default`, `dashboard_disputes_default`, `dashboard_promises_default`.
- Drills wired to report lists: activities `manual-activities`, `total-calls`, `activity-success-rate`, `system-activities`, `portal-activities`; disputes `disputes-created`, `disputes-closed`; promises `promises-to-pay`. Details page is list-only (no metric cards); create/edit views allowed.
- Locked filters: activities `created_at` between + identity marker (manual also `system_generated=false`; total-calls marker); disputes `__dashboard_dispute_family` = `created` (`created_at` between) or `closed` (status Resolved/Cancelled + `closed_at` between); promises `__dashboard_promise_activity` = `{start,end}` (Activity.some membership, CCP grain).
- The legacy `getOperationDashboardDetails` API is stubbed to return empty; orphan KPI types (`automated-activities`, `open-disputes`, …) still call it from the frontend.

### Credit dashboard (`dashboard_credit_customers` / `_invoices`)

- Page `/credit-dashboard/report?type=…` (+ policy / BU / customer / flags). URL `type` picks the system report `dashboard_credit_{customers|invoices}_<type>` as the default view; the report selector stays enabled; add/edit views off. Summary cards kept; mark-reported / bulk actions on `reporting` / `reported` (`CreditDashboardReportViewGrid`).
- Customer types: overdue (plain `overdue_block=true`), capacity, policy_risk, limit_warning, zero_limit_warning, top_up, top_up_expiring, no_policy_exposure, plus portfolio-health types utilization_bin, ar_extreme_moves, utilization_overshoot, limit_capped, negative_daily_cost, exposure_reconciliation, policy_concentration, limit_breach_forecast, breach_dilution, breach_episodes. Invoice types: terms, reporting, reported.
- Enrichment (`CREDIT_DASHBOARD_ENRICHED_CUSTOMER_FIELDS`, `enrichCreditDashboardCustomerRows`): Open AR / count, terms_breach_outstanding, policy_risk_allocated, at_risk_exposure, limit_warning_summary, top_up_*, as_of utilization, many `period_*` metrics. Runs whenever a Customer report requests these fields (any context); sorting by them is in memory. As-of rules: `docs/agents/domain.md`.

### Customer invoices tab — Policy Insights (`customer_unpaid_invoices`)

- Credit-insurance accounts get `all_unpaid_invoices_credit_insurance_policy_insights`, `due_…`, `overdue_…`, `all_invoices_credit_insurance_policy_insights` (default = all unpaid with insights).
- `reports.service` gating: no credit insurance → hide `credit` / `credit_insurance` names; credit insurance + insights present → hide the basic `all_unpaid_invoices` / `due_invoices` / `overdue_invoices` / `all_invoices`. The claims report is always additive. FE: `customerUnpaidInvoicePolicyInsightsReports.ts`; `CustomerInvoiceGrid` treats insights names like the basics.

### Shared toolbar behavior

On report change, `ViewBasedDataGrid` applies `report_config.sorting[0]`, else the view config `defaultSort`. The selected report name shows a tooltip only when truncated (`EndlessScrollToolbar`).

---

## 9. Formulas

Row-level calculated columns, evaluated per source row **before** grouping.

- **Syntax:** numbers, ISO dates `YYYY-MM-DD`, `[Table.field]`, `[formula:<id>]` (chaining), `+ - * /`, parentheses, unary ±, compares `= != < > <= >=`. Compares bind looser than arithmetic (mixing needs parentheses). No `<>` / `==`, no functions, no `eval`.
- **Limits:** 10 formulas per report; expression 500 chars; AST depth 10; decimals 0–6.
- **Operands:** numeric / amount / date / datetime fields on the report's **tables** (not only selected columns — execution merges them into the select). Text / boolean / enum operands blocked.
- **Identity:** stable `id`; output key `formula:<id>`; label unique (case-insensitive). Chaining via `formula-dependencies.ts` (topological eval; cycles and self-reference blocked; a formula with dependents cannot be deleted; a field used by a formula cannot be removed — `blockFieldRemovalForFormulas`).
- **Formats:** `number`, `currency`, `percentage`, `yes_no`; optional `hidden` (filterable, not shown) and `decimals`.
  - Currency: `currencySource` auto = first amount field in the expression (chained formulas inherit an agreed source). No FX.
  - Percentage result: raw fraction → `Intl` percent (`0.03` → `3%`).
  - Percent operands `cost_percent` / `registration_fee_percent` are ÷100 inside formulas only; a redundant `/100` shows a soft warning (`formulas.redundant_percent_division_warning`).
  - Yes/No: raw 1 / 0, shown as locale Yes/No; blank when missing or invalid (never No). In grouped aggregates the cell is formatted as a number.
- **Date compares:** date-only = UTC calendar day; datetime = full instant; date vs datetime field = date at UTC midnight; datetime vs typed date = calendar day. Date ± date and date vs number are rejected (`compare_type_mismatch`, `date_arithmetic_not_allowed`).
- **Math and errors:** Decimal arithmetic, rounding only at format. Missing operand / ÷0 / non-finite → blank cell; everything except missing operand counts toward `formulaWarnings` (`formulas.warning_summary`).
- **Aggregation:** grouped reports only — SUM / AVG / MIN / MAX (no COUNT); defaults to SUM when grouping turns on (`alignFormulaAggregationsWithGrouping`); stripped when ungrouped.
- **Formula filters:** field `formula:<id>`, table `__formulas__`; every formula is eligible (including hidden). Pipeline: database filters → fetch → evaluate → formula filters (AND) → paginate, so `totalRecords` is correct. Number / currency / percentage: equals, not equals, gt / lt / gte / lte, empty / not empty on the **raw** value (percentage as a fraction, hint `values.filter_percentage_raw_hint`). Yes/No: equals / not equals / empty / not empty, stored as 1 / 0; blank matches neither. On grouped reports formula filters run on detail rows before grouping. A filter pointing at a deleted formula fails save and execute (`ORPHAN_FORMULA_FILTER`, `validation.orphan_formula_filter`).
- **Sorting by formula** is not supported (formula columns `sortable: false`; `formulas.sort_search_locked`).
- **Editor UX:** `FormulaUpsertModal` (AppDialog) opened from the field selector's Add; insert via object + field + Insert; Help dialog (`formulas.help_*`); delete confirmation; unsaved close discards silently; Add disabled at 10 (`formulas.max_reached`). Validation is shared (`validateFormulaDraft`, `validateAllReportFormulas`); a failing save jumps to the fields step with row errors. Server create/update does not re-validate expressions (execute evaluates them).

---

## 10. Metadata and special fields

Tables: Customer, Invoice, InvoicePayment, Contact, Activity, Person, Company, Dispute, CustomerCollectionPeriod, CustomerPolicy (credit insurance only), Claim; hidden AccountBankAccounts, Country. Relationships typed one-to-many / many-to-one / one-to-one.

- **Computed fields** (`isComputedReportField`) — e.g. Invoice `days_overdue`, `days_until_due`, `days_left_for_reporting`, `terms_breach_reason`; many Customer credit/period metrics; Activity `call_time`, `call_direction`; Dispute `dispute_number`, `amount_in_dispute`, `days_past_due`. Filled after fetch.
- **Trend-backed Customer fields** (`report-customer-trend-fields.util.ts`): only `top_up_total` and `effective_approved_limit`, from the latest `CustomerPolicyTrend`.
- **Daily policy cost fields** (`policy_daily_cost_change`, `top_up_daily_cost_change`, `total_daily_cost_change` + currencies, `cost_calculation_method`, `policy_cost_snapshot_date`) are listed in metadata but **not wired** to trend data — they render blank (see Known gaps).
- **Fee rates** `cost_percent`, `registration_fee_percent` on Customer and CustomerPolicy. On Customer they come from the active CustomerPolicy, else the linked InsurancePolicy (`extractCustomerPolicyReportField`); null stays empty. Customer rate filters / sorts run in memory (`pickCustomerPolicyRateFilters`, `applyCustomerPolicyRateFiltersToRows`); on CustomerPolicy they are plain columns. These are **live** rates, not trend snapshots.
- **CustomerPolicy table** ("Customer Policies"): one row per **active** assignment (`is_active: true` enforced by scope); scalars plus nested `Customer.name` / `customer_number` and `InsurancePolicy.policy_number`. Links resolve to the customer. Customer→CustomerPolicy treated as to-many for grouping. Inactive/history rows are not available.
- **Links** (`getFieldLinkMetadata`): customer name, parent customer, contact, dispute number link to detail pages. Invoice number is **not** linked.

---

## 11. Builder (frontend)

Steps: Basic info (name, description; admin: location/context, system, default) → Tables & fields → Filters → Grouping → Chart (admin, placeholder).

- **Fields:** drag from metadata; numeric fields can take SUM / AVG / COUNT / MIN / MAX. Column order via dnd-kit + `shared/reportFormula/columnOrder.ts`. Sort ASC/DESC on field cards (default: first field ASC); formula cards reorder only.
- **Aggregation ⇒ grouping:** any aggregated field auto-adds every non-aggregated field to `grouping`; aggregated fields cannot be grouping keys.
- **Filters:** operators by type — string (equals, not equals, contains, starts/ends with, empty), number (compares, empty), date/datetime (compares, `between`, empty, presets), enum (`in` / `not_in`, equals, empty), boolean. All AND. Presets (today, yesterday, tomorrow, this/last/next week|month, last/next X days|months, custom) are stored as `{ __datePreset, __datePresetInput? }` and resolved on the server with the **server** calendar.
- **Save:** `POST /api/reports` or `PUT /api/reports/:id` with `{ name, description, report_config, context?, is_system?, is_default? }`; clone always POSTs.

---

## 12. Viewer (frontend)

- Grid execute: `PAGE_LIMIT` **20**, infinite scroll (`useVirtualInfiniteScroll`). Sends `locale`, `language`, `timezone`, `search` (500 ms debounce), sort, and session filter overrides (`ReportViewerFiltersModal`, `replaceConfigFilters: true`; refresh clears them).
- Chart: second execute with `CHART_DATA_LIMIT` 10000 when `chart.type !== "table"`.
- Columns: `generateViewColumns` (`enableAggregation`, `aggregationTotals`, link handlers, `columnOrder`).
- **Header aggregation suffix** (`getAggregationLabelSuffix`): COUNT uses server `aggregationTotals`; SUM / AVG / MIN / MAX use **loaded rows only**.
- Formula warnings shown as an alert. Edit disabled for system reports unless admin. Share via `ShareReportModal` (user or role, view / edit).

---

## 13. Export

| Path | How |
| --- | --- |
| Viewer CSV / Excel | Re-execute with limit 10000 → map `___formatted_*` → `exportToExcel` (ExcelJS) in the browser |
| Viewer PDF | `GET /api/reports/:id/export?format=pdf…` |
| System / scheduled | `POST internal/reports/:id/export` → `buildReportExport` → CSV bytes (`excel` = CSV with Excel content type; `pdf` falls back to CSV) |

**Money split (CSV and Excel, browser and server mirror each other):** a cell with money-with-currency text (code or symbol before or after; Hebrew bidi marks / NBSP stripped) becomes a real number under the original header, plus a sibling `{Header} (Currency)` column — added only when at least one value in that column has a currency. Unreadable currency → blank (no account default). Bare numbers stay numbers with no empty currency column; days / counts / policy ids are left alone. PDF has no split.

`ExportDialog` is shared by every grid: file name, format (excel / csv / pdf), column checkboxes. Export is disabled without `export_report` or when there are no rows.

---

## 14. Formatting

- Money: `formatMoneyIso` — EN `USD 1,200`, HE `1,200 USD` with direction mark. Currency from row fields (`customer_currency`, `currency`, …), then account currency (default USD). Grouped money aggregates take the **first row's** currency.
- Numbers: `Intl.NumberFormat(locale)`. Booleans: `Yes` / `No` (server, not localized).
- Dates: date-only in the UTC calendar; date-times in the request `timezone`; Hebrew uses 24h.

---

## 15. Limits

| Limit | Value |
| --- | --- |
| Execute `limit` | default 20, max 10000 |
| Public export re-execute | 5000 rows |
| List page | 100 |
| Formulas | 10 per report, 500 chars, depth 10 |
| Full-fetch paths | No row cap (whole filtered set in memory) |

---

## 16. i18n

Namespace `reports` (`locales/{en,he}/reports.json`): `fields`, `actions`, `labels`, `messages`, `values` (operators, aggregations), `tables`, `sections`, `tooltips`, `validation`, `formulas` (+ `errors`, `help_*`). Export dialog strings in `common`; permission labels in `security_roles`. New copy ships in EN and HE together.

---

## 17. Known gaps

**Not wired:**
- Daily policy cost fields are in metadata but render blank (not wired to `CustomerPolicyTrend`).
- `chartData` is not returned by execute, and the builder chart step is a placeholder.
- Operation dashboard orphan KPI types still call the stubbed legacy API (always empty).

**Not enforced / not built:**
- Fee rates allow SUM even though only AVG is meaningful (no `disallowedAggregations` metadata).
- Filtering an Invoice-grain report by `Customer.cost_percent` (joined policy-backed field) is skipped.
- Server create/update does not validate formula expressions.
- Shares / `is_public` do not restrict visibility.
- Date presets use the server calendar, not the user's timezone.
- Invoice number cells are not links.
- Formula sort, HAVING-style filters on aggregated values, FX conversion, text/boolean compares in formulas, CustomerPolicy history rows, InsurancePolicy or CustomerPolicyTrend as report tables.
