---
name: policy-cost-report-builder
overview: Expose daily insurance policy cost fields from CustomerPolicyTrend as virtual Customer columns in the report builder, with credit-insurance gating, filter/sort, and export support.
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869dwn9v4
isProject: false
---

# Policy cost fields in report builder

## Problem Statement

Credit insurance accounts now persist **daily policy cost**, **top-up daily cost**, and **total daily cost** on `CustomerPolicyTrend` snapshots (one row per customer per UTC calendar day). Users can see this on the customer dashboard KPI and chart, but **cannot include cost in ad-hoc or saved reports**, exports, or filtered customer lists.

Finance and credit teams need to answer questions such as “which customers have the highest daily insurance burn?”, “who has policy cost configured but null top-up cost?”, and “what is the combined daily cost for customers in a business unit?” without manually exporting dashboard data or rebuilding spreadsheets from policy settings and premiums.

The daily-cost PRD explicitly deferred report builder support; this PRD covers that gap.

## Solution

Add **virtual Customer fields** to the report builder that read from each customer’s **latest** `CustomerPolicyTrend` row (highest `snapshot_date` for that customer within the account). Values are point-in-time from the trend snapshot pipeline — not recomputed on read.

Expose **eight fields** on the Customer table in report metadata:

| Field | Purpose |
|-------|---------|
| `policy_daily_cost` | Primary policy daily cost amount |
| `policy_cost_currency` | Currency for policy cost (limit currency) |
| `top_up_daily_cost` | Aggregated top-up daily premium rate |
| `top_up_cost_currency` | Premium currency when aggregation is valid |
| `total_daily_cost` | Combined daily cost when combinable |
| `cost_calculation_method` | Snapshotted method (`ActualSales` / `Limit`) |
| `cost_percent` | Snapshotted Cost % (daily rate) |
| `policy_cost_snapshot_date` | Read-only date of the trend row used |

Users build **Customer-primary** reports or join Customer from Invoice/Payment/Activity reports and select these fields like existing credit-insurance columns (e.g. approved limit). Amount and currency are **separate columns** (no forced FX formatting). Null values render as **empty cells** in grid and export — not “Not configured” and never coerced to zero.

Fields are **gated** behind the credit insurance product (`Account.has_credit_insurance`), matching other credit-only report columns. Users can **filter and sort** on all cost amount fields. Grouped reports may **SUM/AVG** amount fields; mixed-currency portfolio totals are allowed with the understanding that aggregates across customers may be unreliable when currencies differ.

**Prerequisite:** Daily cost columns must be populated on `CustomerPolicyTrend` by the existing trend snapshot job (daily-cost feature). This PRD does not change cost formulas or snapshot writers.

## User Stories

1. As a credit insurance user, I want **policy daily cost** available as a Customer column in report builder, so that I can list customers by primary-policy insurance burn.

2. As a credit insurance user, I want **top-up daily cost** available as a Customer column, so that I can see supplemental premium burn alongside policy cost.

3. As a credit insurance user, I want **total daily cost** available as a Customer column, so that I can see combined daily insurance spend per customer in one figure.

4. As a credit insurance user, I want **separate currency columns** for policy and top-up cost, so that I know which currency each amount uses without forced conversion.

5. As a credit insurance user, I want **cost calculation method** and **cost percent** from the snapshot row in reports, so that I can audit how daily cost was computed on that day.

6. As a credit insurance user, I want a **policy cost snapshot date** column showing which trend day the values came from, so that I understand whether I am seeing today’s cron row or an older snapshot.

7. As a credit insurance user, I want cost fields to reflect the **latest available trend row** per customer, so that reports stay useful when today’s snapshot has not run yet or cron lagged.

8. As a credit insurance user, I want to **filter** customers by daily cost (e.g. total daily cost greater than X), so that I can find high-burn accounts.

9. As a credit insurance user, I want to **sort** customers by policy or total daily cost, so that I can rank spend without leaving the report builder.

10. As a credit insurance user building an **Invoice report with joined Customer fields**, I want the same cost columns available, so that I can correlate receivables with insurance burn.

11. As a credit insurance user, I want cost fields **hidden** when my account does not have credit insurance, so that non-credit customers are unaffected.

12. As a credit insurance user whose account loses credit insurance, I want **saved reports** that reference cost fields to fail clearly on execution, so that I know the product is disabled — consistent with other credit-only report columns.

13. As a credit insurance user, I want **null cost** to appear as an empty cell in the grid and export, so that missing configuration is not shown as zero.

14. As a credit insurance user with **mixed top-up premium currencies**, I want top-up daily cost null in reports (matching snapshot rules), so that I am not misled by invalid aggregates.

15. As a credit insurance user with **policy and top-up in different currencies**, I want total daily cost to follow snapshot combinator rules (policy-only partial or null), so that report values match dashboard and trend storage.

16. As a credit insurance user with **no cost configuration** on the primary policy, I want policy daily cost null in reports, so that absent setup is not shown as free coverage.

17. As a credit insurance user **excluded from policy** or with **outdated DCL**, I want cost null for that customer, so that ineligible assignments do not show burn.

18. As a collection manager, I want cost history in reports to reflect **forward-only** trend data (from when snapshots started storing cost), so that I understand older trend rows may have null cost columns.

19. As a credit insurance user running a **grouped report** (e.g. by owner), I want to sum total daily cost across customers in a group, so that I can approximate portfolio daily burn — accepting that mixed currencies may make totals approximate.

20. As a credit insurance user, I want **exported Excel/CSV** to include raw amount and currency columns, so that I can pivot and analyze in external tools.

21. As a credit insurance user without top-up policies, I want top-up cost columns still selectable but **null** when not applicable, so that report templates work across accounts with and without top-ups.

22. As a developer, I want trend-backed cost fields resolved through a **single report-field helper module** (parallel to active CustomerPolicy-backed fields), so that metadata, query building, execution, and export stay consistent.

23. As a developer, I want automated tests on that helper and on filter/sort behavior, so that regressions are caught without manual report runs.

24. As a QA engineer, I want manual verification of a customer list sorted by total daily cost and an export with null cells, so that end-to-end report builder behavior is confirmed.

25. As a product owner, I want **historical daily rows** (one row per customer per day as primary table) deferred, so that v1 delivers list/export value without a new report entity.

26. As a product owner, I want **FX conversion** of cost into account base currency deferred, so that v1 matches stored snapshot semantics.

27. As a localization stakeholder, I want **EN/HE labels** for new field names in report builder, following the project translation approval process.

28. As a credit insurance user filtering by **policy cost snapshot date**, I want to find customers whose latest cost snapshot falls in a date range, so that I can identify stale or missing snapshot coverage.

29. As a credit insurance user, I want **cost calculation method** displayed as an enum label (Limit / Actual Sales) in reports, so that values are human-readable.

30. As a developer consuming report metadata API, I want new fields only when `has_credit_insurance` is true, so that the field picker stays clean for non-credit accounts.

## Implementation Decisions

### Virtual Customer fields from latest trend row

Do **not** add `CustomerPolicyTrend` as a selectable primary report table in v1. Instead, register cost fields on the **Customer** table in report metadata. At execution time, resolve each field from the customer’s **latest** `CustomerPolicyTrend` row: highest `snapshot_date` for `(account_id, customer_id)`. If no trend row exists, all cost fields are null.

This differs from the customer dashboard KPI path, which reads **UTC today only**. Reports intentionally use latest-row semantics so lists remain populated when today’s cron has not yet run.

### Field catalog and types

- **Amount fields** (`policy_daily_cost`, `top_up_daily_cost`, `total_daily_cost`, `cost_percent`): numeric; nullable.
- **Currency fields** (`policy_cost_currency`, `top_up_cost_currency`): string; nullable.
- **Enum field** (`cost_calculation_method`): `ActualSales` | `Limit`; nullable.
- **Date field** (`policy_cost_snapshot_date`): date; maps to `snapshot_date` on the chosen trend row; read-only indicator of data freshness.

All seven stored cost columns from the trend row are exposed plus the snapshot date alias. Live `InsurancePolicy.cost_calculation_method` / `cost_percent` (policy settings, not computed daily cost) are **not** exposed in v1.

### Single implementation seam (preferred)

Introduce one **trend-cost report field module** (same role as the existing CustomerPolicy-backed report helper):

1. **`isTrendCostBackedReportField(field)`** — identifies the eight virtual Customer fields.
2. **`extractCustomerTrendCostReportField(row, field)`** — given a Customer query row (with latest trend relation loaded or enriched), returns the display value.
3. **`mergeLatestCustomerPolicyTrendSelect(select, fields)`** — merges Prisma select for latest trend row columns needed by requested fields.
4. **Filter/sort registration** — hooks used by report query builder for trend-backed predicates and order-by.

Report metadata, credit-insurance field gating sets, query builder, execution formatter, and export pipeline all delegate to this module. **Ideal test seam:** unit tests on the helper module; one integration test for filter + sort on `total_daily_cost`.

If Prisma cannot express latest-row filters efficiently, implement filter/sort via a documented subquery or lateral join pattern inside query builder — still routed through the same field registry so metadata and SQL stay aligned.

### Credit insurance product gating

Add all eight field names to the **credit-insurance Customer report field allowlist**. When `Account.has_credit_insurance` is false:

- Omit fields from report metadata API response.
- Block execution of saved reports whose config references any of these fields (same error pattern as other credit-only columns).

Do **not** additionally gate on `hasTopUpPolicies`; top-up columns remain selectable and null when no top-ups apply.

### Query and execution behavior

- **Customer-primary reports:** load latest trend slice when any cost field is selected, filtered, sorted, or grouped.
- **Joined Customer** (Invoice, Payment, Activity primary): extract cost from nested Customer using the same helper as active CustomerPolicy fields.
- **Null rules:** pass through snapshot nulls; never substitute 0.
- **Display:** empty cell for null amounts; enum labels for method.

### Filter and sort

Full filter and sort support on **`policy_daily_cost`**, **`top_up_daily_cost`**, and **`total_daily_cost`** in v1. Filter/sort on **`cost_percent`** follows the same numeric pattern. **`policy_cost_snapshot_date`** supports date filters. Currency and enum fields follow standard report filter types for string/enum columns.

### Aggregation in grouped reports

Allow **SUM** and **AVG** on numeric amount fields. Document in Further Notes that portfolio-level sums may mix currencies and that per-customer `total_daily_cost` may already be null under mixed policy/top-up currencies. No special aggregation engine for v1 — generic numeric aggregation only.

### Translations

New report field labels require **EN/HE** keys under appropriate namespaces (`customers`, `credit_insurance`, or `reports`). Follow project rule: translation file changes require explicit approval before merge.

### Schema and API

**No schema changes.** Cost columns already exist on `CustomerPolicyTrend`. Report metadata API continues to filter credit fields by product flag. No new public REST endpoints — report builder uses existing metadata and execute/export APIs.

### Relationship to daily-cost feature

Depends on trend snapshot job persisting: `policy_daily_cost`, `policy_cost_currency`, `top_up_daily_cost`, `top_up_cost_currency`, `total_daily_cost`, `cost_calculation_method`, `cost_percent`. Formula and writer logic are owned by the daily-cost PRD; this PRD is read-only over stored columns.

### Decision log (grill-me)

| Topic | Decision |
|-------|----------|
| Report shape | Virtual Customer fields; no CustomerPolicyTrend report table |
| Field scope | All 7 trend cost columns + snapshot date |
| Snapshot anchor | Latest row per customer (not UTC-today-only) |
| Currency | Separate amount + currency columns |
| Null display | Empty cell; never show 0 for null |
| Gating | `has_credit_insurance` only |
| Filter/sort | Full support on amount fields |
| Joined reports | Yes — Invoice/Payment/Activity + Customer |
| Aggregation | SUM/AVG allowed; mixed-currency caveat |

## Testing Decisions

### What makes a good test

Test **observable report behavior**: given trend rows (or mocked relation payloads), metadata visibility, extracted field values, filter/sort query shapes, and formatted output — not internal Prisma call order. Prefer the **single trend-cost report field module** for unit tests; add targeted report execution or query-builder tests only where wiring cannot be covered by the helper alone.

### Proposed test seam

**Primary seam:** trend-cost report field helper — field identification, latest-row extraction, null passthrough, enum mapping, snapshot date alias.

**Secondary (minimal):** credit-insurance field usage detector includes new field names; one query-builder or execution test proving filter and sort on `total_daily_cost` produce correct results for customers with different snapshot dates.

Confirm with implementer that this seam matches expectations before coding; avoid duplicating tests across metadata, export, and builder UI layers.

### Modules to test

1. **Trend-cost report field helper** — all eight fields; null when no trend row; latest row wins when multiple dates exist; currency passthrough.
2. **Credit-insurance field reference detector** — saved config referencing cost fields flagged correctly.
3. **Optional integration** — Customer report filtered by `total_daily_cost > N` returns expected customer set when trend fixtures exist.

### Prior art

- CustomerPolicy-backed report field tests (`extractCustomerPolicyReportField`, filter wiring).
- `reportCreditInsuranceFieldUsage` unit tests for gating detection.
- Report execution / query builder tests for credit-insurance Customer columns.

### Manual QA

- Credit-insurance account: Customer report with all eight columns; verify values match latest trend row in DB.
- Sort descending by `total_daily_cost`; verify order.
- Filter `total_daily_cost` is not empty; export to Excel; null cells blank.
- Non-credit account: fields absent from picker; saved credit report fails with product-disabled error.
- Invoice report + joined Customer cost columns populated for invoice’s customer.

## Out of Scope

- **CustomerPolicyTrend as a report table** (one row per customer per day for historical time-series reports).
- **User-selectable snapshot date** as report parameter (beyond filtering on `policy_cost_snapshot_date`).
- **Live InsurancePolicy** cost config fields on Customer (settings, not computed daily cost).
- **FX conversion** of policy or top-up cost into account base currency in reports.
- **Historical backfill** of cost on old trend rows.
- **Account-level / portfolio daily cost KPIs** in report builder.
- **Recomputing cost formulas** on report read.
- **Separate gating** on `hasTopUpPolicies` for top-up columns.
- **Dashboard “Not configured”** label in report grid/export.
- **Changes to trend snapshot writer** or cost computation module.

## Further Notes

### Codebase scan (implementation touchpoints)

**Required**

- Report metadata static definitions — add eight Customer fields with types and enum options for `cost_calculation_method`.
- Credit-insurance Customer report field name registry — register all eight names for gating and saved-report detection.
- New trend-cost report field helper module — extraction, select merge, filter/sort field registry.
- Report query builder — latest-row trend join/select; apply trend-backed filters and sort order.
- Report execution service — format-time extraction for Customer-primary and joined Customer rows.
- Unit tests for helper and gating; filter/sort integration test.

**Optional**

- Report export service — only if export path bypasses standard formatters.
- Report field utils — enum label formatting for `cost_calculation_method`.
- Locale files (EN/HE) — field labels; requires explicit approval.

**No change needed**

- `CustomerPolicyTrend` schema and migrations — cost columns already present.
- Daily cost computation and snapshot cron — writer unchanged.
- Customer dashboard KPI/chart — separate feature; may later share latest-row helper.
- `ONE_TO_MANY_MAP` — trend table not exposed as 1:N report entity.

### Mixed-currency aggregation caveat

When grouping customers and summing `total_daily_cost`, totals may combine USD, EUR, and other currencies. Per-customer totals may already be null when policy and top-up currencies differ. Users should treat grouped sums as indicative unless they filter to a single currency context (e.g. via separate reports or filters on currency columns).

### Daily-cost PRD alignment

Update daily-cost PRD out-of-scope item “Report builder / export fields for daily cost” when this ships. User story #26 in that PRD deferred report builder; this PRD supersedes that deferral.

### Prisma latest-row spike (informational gate)

Before implementation, confirm query builder can filter/sort on latest trend row via Prisma relation (`orderBy` + `take: 1`) or requires SQL lateral join. If Prisma-only approach fails for filters, implement subquery in query builder while keeping the single field-helper seam.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Policy cost fields in report builder](https://app.clickup.com/t/869dwn9v4)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Trend-cost fields — metadata, gating & Customer report display | [869dwn9vm](https://app.clickup.com/t/869dwn9vm) | — | 1–7, 11, 13–18, 21–22, 30 |
| 2 | Filter, sort & export on policy cost fields | [869dwn9w0](https://app.clickup.com/t/869dwn9w0) | #1 | 8, 9, 20, 23, 28 |
| 3 | Joined Customer reports, saved-report guard & i18n labels | [869dwn9wa](https://app.clickup.com/t/869dwn9wa) | #1 | 10, 12, 19, 24, 27, 29 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development

**Tags:** `ready-for-agent`, `enhancement`, `credit-insurance`
