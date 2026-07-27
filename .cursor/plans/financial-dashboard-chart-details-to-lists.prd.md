---
name: financial-dashboard-chart-details-to-lists
overview: Convert financial dashboard chart-details drill-downs into report-backed lists (saved views), starting with invoice-shaped chart types, with exact KPI filter parity and metric cards retained.
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869e3hmku
isProject: false
---

# Financial Dashboard Chart-Details → Report Lists

## Problem Statement

On the **financial dashboard**, KPI and aging/maturity drill-downs open **chart-details**: a detail page with summary metric cards and a grid of underlying rows (invoices, customers, payments, or collection efforts depending on the chart).

That grid is a **fixed-column list**, not a **report** (saved view). Users cannot choose columns, save personal defaults, or reuse the same report builder experience they have on Customers, Invoices, and customer unpaid invoices. Collection managers who live in the financial dashboard therefore get a weaker analysis tool exactly where they drill into the numbers that matter.

The product already has a mature reports stack (contexts, system reports, `additionalFilters`, report execute). Chart-details should become report-backed lists, without losing today’s drill-down meaning: the same business-unit filter, owner scope, aging/due buckets, and metric-card totals must still match the dashboard KPIs.

## Solution

1. **Report-backed chart-details** — For supported chart types, replace the fixed grid with a view-based report list on a new dashboard-scoped report context. Users get a report selector, system defaults, and the ability to create/edit saved views (with existing report permissions).

2. **Contexts by row shape** — Introduce dashboard report contexts grouped by entity shape. First delivery uses **`dashboard_invoices`** for invoice-shaped chart types. Later deliveries add customer, payment, and collection-effort contexts.

3. **Locked drill-down filters** — Chart URL parameters (`type`, `daysRange`, `viewMode`, `businessUnitId`, and any other params that define the KPI slice) become **locked additional filters** always AND-merged with the selected report. Changing the saved view changes columns (and optional extra filters inside the slice); it does not widen past the KPI the user clicked.

4. **Exact KPI parity** — Row membership and amounts must match today’s chart-details / dashboard KPI semantics (statuses, Active/Inactive customer rules, aging vs maturity day buckets, owner filter, URL business-unit selection).

5. **Keep metric cards** — Retain the summary cards above the grid, fed by a thin summary path that shares the same filter semantics as the list (not a full row dump solely for cards).

6. **Chart-details only** — These contexts are not listed as standalone entries on the main Reports menu. Create/edit opens the report builder and returns to chart-details (same pattern as customer unpaid invoices).

7. **Permissions** — Users with **view financial dashboard** can execute `dashboard_invoices` reports on chart-details even without **view reports**. Creating and editing saved views still requires the normal report permissions.

8. **Phased rollout** — Invoice-shaped types first while other chart types keep the existing fixed list. Then customers → payments → collection efforts. Other detail pages (e.g. operation dashboard) are separate PRDs.

## User Stories

1. As a collection manager, I want financial dashboard drill-downs to use saved views, so that I can analyze the same KPI slice with columns I care about.

2. As a collection manager, I want system default reports that match today’s columns per chart family (overdue, aging, due, maturity), so that the first open still feels familiar.

3. As a collection manager, I want the report selector on chart-details, so that I can switch among system and personal views without leaving the drill-down.

4. As a collection manager with create-report permission, I want to create a custom report for `dashboard_invoices`, so that I can save column layouts for recurring analysis.

5. As a collection manager with edit-report permission, I want to edit my custom dashboard invoice reports, so that I can refine them over time.

6. As a collection manager, I want system reports to be read-only, so that shared defaults cannot be accidentally broken.

7. As a collection manager, I want the full Invoice field catalog in the builder for this context, so that I can add any invoice field available on the main invoices reports.

8. As a collection manager, I want metric cards to remain above the list, so that I still see count/amount summaries for the KPI I opened.

9. As a collection manager, I want metric card totals to match the list’s underlying slice, so that cards and rows do not disagree.

10. As a collection manager, I want clicking an overdue-invoices KPI to lock the list to that overdue invoice set, so that switching reports cannot expand into unrelated invoices.

11. As a collection manager, I want clicking an aging portfolio bucket to lock the list to that days-overdue range, so that bucket drill-down stays exact.

12. As a collection manager, I want due-today / due-this-week / due-this-month / due-next-month / total-due drills to lock the correct due window, so that due KPIs remain trustworthy.

13. As a collection manager, I want receivables maturity bucket drills to lock the correct future due window, so that maturity schedule analysis stays accurate.

14. As a collection manager using the dashboard business-unit filter, I want chart-details lists and cards to respect the selected business unit, so that drill-downs match the filtered dashboard.

15. As a collection agent with owner-scoped access, I want chart-details report lists to apply the same owner scope as today’s chart-details, so that I never see other agents’ invoices through a report execute path.

16. As a user with financial dashboard access but without view-reports, I want to open invoice chart-details and scroll the list, so that converting to reports does not revoke my existing ability to see drill-down data.

17. As a user without create/edit report permission, I want to use system (and any shared) reports on chart-details, so that I still benefit from defaults without managing views.

18. As a collection manager, I want search/sort/export on the report list, so that chart-details matches other report-backed grids.

19. As a collection manager, I want export to honor the locked KPI filters, so that exports match what I see on screen.

20. As a collection manager, I want non-invoice chart types to keep working as they do today during the first rollout, so that collected/MTD, customer, and collection-effort drills are not broken while invoices convert.

21. As a collection manager, I want later conversions for customer-, payment-, and collection-effort-shaped drills to follow the same locked-filter + context-by-shape pattern, so that the financial dashboard becomes consistently report-backed.

22. As a product admin, I want system reports seeded for every account for `dashboard_invoices`, so that new and existing tenants get the four family defaults.

23. As a product admin, I want new accounts to receive those system reports automatically, so that onboarding does not require manual SQL per tenant.

24. As a collection manager creating a report from chart-details, I want the builder to return me to chart-details for this context, so that I am not dropped onto an unrelated page.

25. As a collection manager, I want parent/child view mode (when used by invoice drills) to keep the same meaning as today, so that hierarchy-sensitive KPIs do not silently change.

26. As a collection manager, I want invoice number and customer links in the list to open the usual detail pages, so that navigation from drill-down stays consistent with other invoice lists.

27. As a collection manager, I want the main Reports menu to stay focused on primary report locations, so that dashboard-only contexts do not clutter `/app/reports`.

28. As a QA engineer, I want documented expected membership rules per chart family, so that parity with legacy chart-details can be verified.

29. As a developer, I want a single filter-mapping seam shared by summary cards and list execution, so that cards and rows cannot drift apart.

30. As a collection manager on mobile, I want the report list to remain usable in the existing chart-details layout, so that drill-downs still work on smaller screens without new bespoke styling.

## Implementation Decisions

- **Target UI:** Use the existing view-based data grid (report selector + saved views) on chart-details for converted types—not a plain endless-scroll-only grid, and not a redirect into the main invoices list.

- **First context:** `dashboard_invoices`, backed by the Invoice table, registered like other nested contexts (e.g. customer unpaid invoices).

- **Metadata:** Reuse the existing Invoice report field catalog; do not invent a parallel invoice metadata set for dashboard.

- **System reports:** Seed four system reports for chart families—overdue, aging, due, maturity—with default columns matching today’s chart-details column sets. Auto-select by URL `type`; users may switch.

- **Filter model:** Map chart URL params to locked additional filters AND-merged with the selected report’s config. Shared immutable base filters may live on the system report; URL-variable locks (bucket, due window, BU, etc.) live in the mapper.

- **Parity bar:** Exact match to current chart-details membership and amounts, including status rules, customer Active/Inactive differences between overdue vs due families, aging vs maturity `daysRange` encodings, owner scope, and URL business-unit selection.

- **Report execute gaps to close for this context:** Today’s report execute path does not fully mirror chart-details owner scoping or dashboard URL business-unit selection. Those must be applied server-side for `dashboard_invoices` (not trusted as client-only filters for authorization).

- **Permissions:** Execute allowed when the user has view financial dashboard **or** view reports for `dashboard_invoices`. Create/edit/delete remain on existing report permissions. Report list/default endpoints used by the selector must not block financial-dashboard-only users from loading system defaults for this context.

- **Metric cards:** Keep existing card UX; power them with a thin summary that reuses the same filter semantics as the list mapper.

- **Dual-mode page:** Invoice-shaped types use the report list; all other chart types keep the current fixed list and API until later slices.

- **Invoice-shaped types in slice 1:** `overdue-invoices`, `aging-portfolio`, `total-due`, `due-today`, `due-this-week`, `due-this-month`, `due-next-month`, `receivables-maturity-schedule`.

- **Location:** Context is chart-details only; not added to the main Reports menu location. Builder redirect for this context returns to chart-details with appropriate type params.

- **Seeding:** SQL system-report seed for all accounts (same operational pattern as customer unpaid invoices), plus ensure new-account system-report copy includes this context.

- **Translations:** Prefer existing dashboard copy where possible; new report names may use English seed strings until translation edits are explicitly approved.

- **Styling:** Reuse existing grid/chart-details patterns; no new visual system work unless separately approved.

- **Later financial contexts (same PRD program, later slices):** customer-shaped, payment-shaped, and collection-effort-shaped dashboard contexts following the same locked-filter rules.

## Testing Decisions

### What makes a good test

- Assert **external behavior**: given chart URL params (and user scope), the locked filters / execute result membership and summary totals match the legacy chart-details rules; permissions allow or deny as specified; the correct system family is selected for a `type`.
- Do **not** assert React component internals, private QueryBuilder AST shape, or pixel layout.

### Primary test seam (preferred: one high seam)

**Dashboard invoice drill-down filter contract** — a pure (or near-pure) mapper from chart-details URL/query inputs (+ authenticated scope inputs the server already knows) to the locked filter set and summary identity used by both metric cards and report execute.

Tests should treat this contract as the single source of truth for KPI parity. Prefer extending this seam over adding many UI-only tests.

If the mapper alone cannot cover authorization, pair it with a thin execute-permission/scoping check at the report execute boundary for `dashboard_invoices` only—still behavior-level, not QueryBuilder internals.

### Modules / behaviors under test

- URL/query → locked filters for each invoice chart family and `daysRange` variant
- Summary totals vs locked slice (same contract)
- Execute permission: financial-dashboard-only user can run `dashboard_invoices`; cannot use that exception for unrelated contexts
- Owner + URL business-unit scoping applied for this context
- System family selection by `type`
- AND-merge of locked filters with report config (existing view-execution tests / fixtures as prior art)

### Prior art

- Customer unpaid invoices list: nested context + additional filters
- View execution / view-based grid report tests and report fixtures
- Dashboard business-unit filter resolution used by financial chart-details today

### Manual QA (still required)

- Each invoice KPI / aging / maturity bucket: cards + rows + export agree with pre-change expectations
- Report switch changes columns but not the KPI slice
- Create/edit returns to chart-details
- Non-invoice chart types unchanged in slice 1

## Out of Scope

- Converting payment-, customer-, or collection-effort-shaped financial chart types (follow-up slices under the same program)
- Replacing Aging Overdue Portfolio / Receivables Maturity Schedule **summary tables on the main financial dashboard** (they remain bucket navigators)
- Redirecting drills into the main Invoices or Customers report pages instead of chart-details
- Listing `dashboard_invoices` on the main `/app/reports` menu
- Operation dashboard details / agent stats tables (next page after financial; separate PRD)
- Admin cron jobs / system health tables
- Changing credit dashboard or Grafana dashboards
- Locale file edits without explicit approval
- New styling / theme work
- Weakening KPI parity to “best effort” standard invoice filters

## Further Notes

- Implementation detail plan (file-oriented) lives alongside this PRD: `.cursor/plans/financial-dashboard-chart-details-to-lists.plan.md`.
- Closest product precedent: customer unpaid invoices on the customer detail page (nested report context + locked customer filter).
- Related prior work: dashboard business-unit filter PRD — URL `businessUnitId` must continue to flow into chart-details and into the new report execute path for parity.
- Maturity overview without a `daysRange` may still be bucket-oriented in the legacy API; invoice-level report conversion should preserve clear behavior (invoice rows when a bucket is selected; do not silently change overview semantics).
- Operation dashboard details were selected as the **next** grill target after financial; they are intentionally not specified here.

### Test seam check

Primary seam proposed: **dashboard invoice drill-down filter contract** (shared by metric summary + locked report filters), plus a minimal execute permission/scoping check for `dashboard_invoices`.

## Issues (vertical slices)

**Parent:** [Financial Dashboard Chart-Details → Report Lists](https://app.clickup.com/t/869e3hmku)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Prefactor: dashboard_invoices filter contract + execute parity | [869e3hmm6](https://app.clickup.com/t/869e3hmm6) | — | 14–16, 22–23, 28–29 |
| 2 | Overdue invoices chart-details as report list | [869e3hmm7](https://app.clickup.com/t/869e3hmm7) | 1 | 1–3, 8–10, 18–20, 26 |
| 3 | Aging portfolio chart-details as report list | [869e3hmm8](https://app.clickup.com/t/869e3hmm8) | 1 | 11 |
| 4 | Due window KPIs chart-details as report list | [869e3hmmc](https://app.clickup.com/t/869e3hmmc) | 1 | 12 |
| 5 | Maturity schedule chart-details as report list | [869e3hmmf](https://app.clickup.com/t/869e3hmmf) | 1 | 13, 25 |
| 6 | Create/edit dashboard invoice reports + builder return | [869e3hmme](https://app.clickup.com/t/869e3hmme) | 2 | 4–7, 17, 24, 27 |

**Assignee / status:** Nilotpal Bose; Selected for Development
