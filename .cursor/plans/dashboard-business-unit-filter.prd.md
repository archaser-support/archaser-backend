---
name: dashboard-business-unit-filter
overview: Scope financial, operational, and credit dashboards to the logged-in user's business unit hierarchy, with a shared business-unit dropdown on all three dashboards (hidden when the user has only one accessible BU).
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869dw4213
isProject: false
---

# Dashboard Business Unit Filtering

## Problem Statement

Users belong to **business units** within an **account**. Customer, invoice, activity, and agent data is already scoped in many parts of the product by the logged-in user's business unit and its descendants — but the three main dashboards do not offer a consistent way to narrow or understand that scope.

The **credit dashboard** does not apply business-unit filtering at all today: metrics and reports are account-wide even when the user should only see customers in their business unit tree.

**Financial** and **operational** dashboards apply server-side business-unit access control implicitly (users only see data for their accessible BUs), but there is no UI control to drill into a single business unit. Users who manage multiple child business units cannot compare or isolate one unit without leaving the dashboard.

Users need dashboard metrics, drill-downs, and credit reports to respect their business-unit access, with an optional filter to focus on one unit — without showing a pointless dropdown when they only have one accessible business unit.

## Solution

1. **Server-side filter resolution** — Introduce a single dashboard business-unit filter resolver used by all three dashboard API stacks. It composes existing access control (`getBusinessUnitFilter`) with an optional selected business unit id from the request. Invalid or out-of-scope ids return **403**. Omitted or "All" means aggregate across all business units the user may access.

2. **Shared dropdown** — Add a `BusinessUnitDashboardFilter` control to the financial, operational, and credit dashboard toolbars. Options come from the existing business-units list API (user's BU + descendants; archaser admin sees all account BUs). Include an explicit **"All"** option. **Hide the control** when the user would have ≤1 option (only "All" with no additional BUs).

3. **URL persistence** — Persist selection as `?businessUnitId=` on dashboard pages and propagate to drill-down links (financial chart details, operational details, credit report routes). Omit the param when "All" is selected.

4. **Credit dashboard parity** — Apply the filter across all credit-insurance dashboard surfaces: summary, history, trends, and report grids. Insurance policy scope remains account-wide; customer-level metrics narrow by business unit.

5. **Operational agent filter** — When a specific business unit is selected, narrow the collection-agent dropdown to agents in that unit.

6. **Translations** — New EN/HE label for the "All business units" option (requires explicit approval before editing locale files).

## User Stories

1. As a collection agent assigned to a leaf business unit, I want dashboard data scoped to my business unit automatically, so that I only see customers and metrics I am allowed to access.

2. As a collection manager assigned to a parent business unit with child units, I want to see aggregated metrics across all units I can access by default, so that I get a portfolio-wide view without extra clicks.

3. As a collection manager with multiple accessible business units, I want a business-unit dropdown on the financial dashboard, so that I can focus on one unit's receivables and collection performance.

4. As a collection manager with multiple accessible business units, I want a business-unit dropdown on the operational dashboard, so that I can review activities, calls, and disputes for a single unit.

5. As a credit insurance user with multiple accessible business units, I want a business-unit dropdown on the credit dashboard, so that I can review exposure and compliance for one unit.

6. As a user with access to only one business unit, I want the dropdown hidden, so that the UI is not cluttered with a meaningless single-option control.

7. As a user who selects "All business units", I want metrics aggregated across every business unit I may access, so that the default view matches today's implicit scope for parent-BU users.

8. As a user who selects a specific business unit, I want all dashboard cards and charts to reflect only that unit's customers, so that numbers are consistent across the page.

9. As a primary-business-unit user, I want "All" to include customers with no business unit assigned, so that unassigned customers remain visible per existing access rules.

10. As a primary-business-unit user who selects a specific child business unit, I want unassigned customers excluded, so that the narrow view shows only that unit's book.

11. As a user who selects a business unit and navigates to a drill-down page, I want the same unit filter applied, so that detail views match the summary I clicked from.

12. As a user who bookmarks a dashboard URL with `?businessUnitId=`, I want that unit pre-selected on load, so that shared links preserve context.

13. As a user on the operational dashboard, I want the agent filter to show only agents in the selected business unit when I pick a specific unit, so that agent metrics align with the unit scope.

14. As a user on the operational dashboard with "All" selected, I want the agent list to include all agents in my accessible business units, so that I can still filter by individual agent across the portfolio.

15. As a user on the credit dashboard, I want summary KPIs, trend charts, and policy usage to respect the business-unit filter, so that credit health reflects the selected scope.

16. As a user on the credit dashboard, I want report drill-downs (terms breach, overdue, etc.) to respect the business-unit filter, so that exported and grid data match the dashboard cards.

17. As a user on the credit dashboard, I want the insurance policy dropdown to remain account-wide, so that I can still filter by policy while narrowing customers by business unit.

18. As a user viewing financial dashboard "invoices by business unit" charts, I want those charts to remain visible when I select a specific unit, so that I can still see the breakdown (even if it shows a single slice).

19. As an archaser admin (account 10013), I want to see all business units on the account in the dropdown plus "All", so that I can inspect any unit without impersonation.

20. As an archaser admin with "All" selected, I want account-wide metrics with no business-unit restriction, so that admin overview behavior is preserved.

21. As a user using View As, I want business-unit options and default scope based on the viewed user's business unit, so that View As reflects what that user would see.

22. As a user who tampers with `businessUnitId` in the URL to an id I cannot access, I want the API to reject the request with 403, so that data cannot be leaked across business units.

23. As a Hebrew-speaking user, I want the "All business units" label in Hebrew, so that the filter matches the rest of the app.

24. As an English-speaking user, I want the "All business units" label in English, so that the filter matches the rest of the app.

25. As a user on a single-business-unit account who is assigned to that unit, I want no dropdown on any dashboard, so that the experience stays clean.

26. As a user on a multi-business-unit account assigned to a leaf unit, I want no dropdown if I can only access that one unit, so that hide-when-one-option applies to my access, not only account-wide BU count.

27. As a user refreshing the financial dashboard, I want cached data keyed to my business-unit selection, so that I do not see stale metrics from a previous filter choice.

28. As a user refreshing the operational dashboard, I want cached data keyed to my business-unit selection and date range, so that cache hits respect the active filter.

29. As a developer, I want one server-side filter resolver for all dashboards, so that access rules stay consistent and are not duplicated across financial, operational, and credit stacks.

30. As a product owner, I want credit dashboard snapshots and history calculations to use the same customer scope rules when a business unit is selected, so that trend lines match summary cards.

## Implementation Decisions

### Primary seam (testing & architecture)

**Single server-side module: dashboard business-unit filter resolution.**

All dashboard API entry points call one resolver with:

- Authenticated user context (including View As overrides already applied by access control)
- Account id
- Optional selected business unit id from query string (absent = "All")

The resolver returns a Prisma-ready customer filter (or equivalent) and validates that a selected id is within the user's accessible set. Financial, operational, and credit services consume this output rather than calling `getBusinessUnitFilter` directly and layering ad hoc logic.

This is the **highest shared seam** — one place for 403 validation, "All" vs specific BU semantics, and primary-BU null-customer inclusion rules. UI is a thin consumer; cache services include the selected id in keys.

### Filter semantics

| Selection | Filter behavior |
|-----------|-----------------|
| **All** (no param) | `getBusinessUnitFilter` — user's BU + descendants; primary-BU users also see `business_unit_id = null` customers |
| **Specific BU id** | Intersect accessible set with `{ business_unit_id: selectedId }` — excludes null-BU customers |
| **Invalid id** | HTTP 403 |
| **Archaser admin, All** | No business-unit restriction (empty filter) |
| **Archaser admin, specific id** | `{ business_unit_id: selectedId }` for that account BU |

Accessible set for validation: user's own BU + descendant ids from business-unit hierarchy service; admin may select any active BU on the account.

**Precondition:** Users are expected to have a business unit assigned. No dedicated empty-state UX for users without a BU; existing impossible filter behavior remains a data/configuration edge case.

### Shared UI component

- **`BusinessUnitDashboardFilter`** — fetches access-filtered business units from the existing entities business-units endpoint; prepends synthetic "All" option; uses `ToolbarDropdownFilter` pattern consistent with operational user filter and financial view-by filter.
- **Visibility:** Render only when more than one selectable option exists (i.e. "All" plus at least one real BU, or admin with 2+ account BUs).
- **State:** Controlled by parent; syncs `businessUnitId` URL search param (omit when All).

### Financial dashboard

- API handler parses optional `businessUnitId`, invokes resolver, passes resulting filter into existing dashboard calculation and cache key generation.
- Container adds filter to React Query key and fetch params.
- Chart-details and related drill-down routes accept and forward `businessUnitId`.
- "Invoices by business unit" charts: **always show** when `hasChildBusinessUnits` is true; when a specific BU is selected, charts reflect filtered data (may be a single segment).

### Operational dashboard

- Main stats and details handlers use resolver output as `business_unit_filter` (service already accepts this parameter).
- Cache service keys include selected business unit id (`"all"` vs numeric id).
- Collection-agents fetch narrows by selected BU when a specific unit is chosen.
- Date range and selected-user URL params continue to work alongside `businessUnitId`.

### Credit dashboard

- **Largest gap today:** credit summary, history, customer-policy trend, insurance-policy trend, report list, and customer-dashboard-kpis endpoints scope by account (and optional policy) only.
- Extend customer scope helpers used by credit dashboard services to AND the dashboard BU filter onto existing `customersScopedForCreditDashboard` (and invoice/customer joins in report queries).
- All credit-insurance API handlers: parse, validate, pass filter to services.
- Page, screen, and report grid: BU filter in toolbar, query keys, navigation links.
- Policy select: unchanged (account-wide assigned policies); combined with BU filter on customer metrics.

### Caching

- Financial and operational dashboard caches must key on **selected** business unit id, not only the user's home BU id, to avoid serving wrong scope after filter changes.

### API contract

- **Query param:** `businessUnitId` (optional integer). Absent or empty = All.
- **Error:** 403 when id is not in accessible set (non-admin) or not on account (admin).
- **No schema changes.**

### i18n

- New key for "All business units" (e.g. under dashboard namespace), EN + HE — requires explicit approval per project rules before editing locale files.

### Grill-me decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | Hide filter | When dropdown would have ≤1 option for this user |
| D2 | Default selection | "All" — aggregate accessible BUs |
| D3 | "All" option | Yes — explicit All + per-BU choices |
| D4 | Archaser admin | All account BUs + All; unrestricted until specific BU selected |
| D5 | Credit scope | Full — summary, history, trends, reports, drill-downs |
| D6 | URL persistence | `?businessUnitId=` on dashboards and drill-downs |
| D7 | No BU assigned | Precondition: users must have a BU |
| D8 | Null-BU customers | Included in "All" for primary-BU users; excluded when specific BU selected |
| D9 | API validation | 403 if businessUnitId not accessible |
| D10 | BU breakdown charts | Always show (single slice when one BU selected) |
| D11 | Op agent filter | Narrow agents when specific BU selected |
| D12 | UI pattern | Shared `BusinessUnitDashboardFilter` component |

## Testing Decisions

**Principle:** Test **external behavior** through the filter resolver's public interface and representative API/service integrations — given user context, account shape, and optional selected BU id, assert the resulting customer filter shape and 403 on invalid ids. Do not assert React component trees or Prisma query internals.

**Primary module under test:** Dashboard business-unit filter resolver.

**Resolver cases:**

| Scenario | Selected BU | Expected |
|----------|-------------|----------|
| Leaf user, All | — | Own BU only (OR single id) |
| Parent user, All | — | Own + descendant BUs (+ null if primary) |
| Parent user, child id | child | `{ business_unit_id: child }` |
| Primary user, All | — | Includes null-BU customers |
| Primary user, specific child | child | Excludes null-BU customers |
| Invalid / peer BU id | other | 403 |
| Archaser admin, All | — | Empty filter (no restriction) |
| Archaser admin, specific | valid account BU | `{ business_unit_id: id }` |
| View As user | — | Uses viewed user's BU tree |

**Integration / service tests (sample):**

- Financial dashboard API: totals change when `businessUnitId` narrows scope.
- Operational dashboard: stats and details respect param; cache key differs for All vs id.
- Credit `getCreditDashboardSummary`: customer counts respect BU filter.
- Collection-agents list: narrowed when BU param present.

**Prior art:** `AccessControlService` unit tests (`getBusinessUnitFilter`), `AgentStatsService` (optional `businessUnitId` merged with base BU filter), operation dashboard service tests if present.
§
**Out of test scope for unit layer:** Full E2E toolbar interaction, cache TTL behavior, Hebrew RTL layout of dropdown.

## Out of Scope

- Changing core `getBusinessUnitFilter` semantics or business-unit hierarchy rules.
- Adding business-unit filter to the **agents** list page (existing filter stays as-is; hide-when-one not retrofitted unless requested).
- Dedicated UX for users without a business unit assignment.
- Business-unit filter on non-dashboard surfaces (reports builder, global search, imports).
- Insurance policies filtered by business unit (policies remain account-scoped).
- New global theme/CSS beyond wiring existing `ToolbarDropdownFilter` and toolbar layout props.
- ClickUp task creation (use `/to-issues` when ready).
- Database schema or migration changes.

## Further Notes

### Suggested implementation order

1. Filter resolver + unit tests  
2. Shared `BusinessUnitDashboardFilter`  
3. Financial dashboard (server already applies base BU scope — smallest delta)  
4. Operational dashboard (cache, details, agent narrowing)  
5. Credit dashboard services and all credit-insurance API handlers + report UI  

### Risk

Credit dashboard touches the most endpoints and query paths; regression risk is highest there. Financial and operational paths mostly need param wiring and cache key updates on top of existing BU-aware services.

### Seams confirmation

The intended **single test seam** is the dashboard business-unit filter resolver. If you prefer separate resolvers per dashboard family, say so before implementation — the PRD assumes one shared module for consistency with D12 and D29.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Dashboard Business Unit Filtering](https://app.clickup.com/t/869dw4213)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | BU filter foundation + financial dashboard | [869dw426h](https://app.clickup.com/t/869dw426h) | — | 2–3, 7–12, 18–24, 27, 29 (+ 19–22) |
| 2 | Operational dashboard BU filter | [869dw4274](https://app.clickup.com/t/869dw4274) | 1 | 4, 11–14, 21–22, 28 |
| 3 | Credit dashboard BU filter (full scope) | [869dw427f](https://app.clickup.com/t/869dw427f) | 1 | 1, 5, 15–17, 21–22, 30 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development per `.cursorrules`

_Slices 2 and 3 can run in parallel after slice 1._
