---
name: business-unit-login-scope
overview: Enforce the logged-in user's business unit assignment app-wide so leaf-BU users (e.g. +131) see only their unit's data silently, while parent-BU users (e.g. +130) aggregate across their accessible hierarchy with optional drill-down where dropdowns exist.
source: grill-me session + credit dashboard bug investigation (uncommitted fix)
clickup_task_url: https://app.clickup.com/t/869dxvf3r
isProject: false
---

# Business Unit Login Scope (App-Wide)

## Problem Statement

Users belong to a **business unit** within an **account**. Access control already derives scope from `User.business_unit_id` and the business-unit hierarchy in many APIs — but enforcement is **inconsistent**. A user assigned to a single leaf business unit (acceptance fixture **+131**) can still see the same headline metrics and data as a parent-unit user (**+130**) on surfaces that query account-wide aggregates without applying the business-unit filter.

This was observed on the **Credit Insurance Dashboard**: Capacity Gap, Terms Breach, and related KPIs matched +130 even when logged in as +131. Root cause: several credit summary code paths ignored the filter returned by the dashboard business-unit resolver even though customer lists were scoped.

Beyond credit, the grilled goal is **app-wide parity**: after login, every list, dashboard, report, search, and import/export path should respect the same business-unit rules — without separate credentials per business unit and without UI chrome for users who only have one accessible unit.

## Solution

1. **Keep existing login** — NextAuth session continues to identify the user; scope comes from `User.business_unit_id` (and View As overrides), not new per-BU credentials.

2. **Introduce a central business-unit scope resolver** — One server module (evolving from today's dashboard filter resolver) that, given authenticated user context and an optional selected business unit id, returns:
   - Prisma-ready **customer filter** (user BU + descendants; primary-BU null-customer rules)
   - **Accessible business unit ids** (for validation and UI)
   - **`showBuPicker`** — false when the user has ≤1 accessible unit (silent scope for +131)
   - **403** when a requested `businessUnitId` is out of scope

3. **Silent auto-scope for single-BU users** — Users with exactly one accessible business unit see data filtered to that unit with **no dropdown and no badge** (grill decision).

4. **Aggregate default for multi-BU users** — Parent-BU users (+130) see aggregated metrics across their accessible tree by default; optional `?businessUnitId=` narrows where dropdowns exist (dashboards per [dashboard-business-unit-filter PRD](dashboard-business-unit-filter.prd.md)).

5. **App-wide adoption** — All high-traffic read paths (entity lists, dashboards, credit reports, global search, report execution) and import/export validation consume the resolver output instead of ad hoc or missing filters.

6. **Credit product boundary** — Customer and invoice credit metrics respect business-unit scope; **insurance policy configuration and policy dropdown remain account-wide** (grill decision).

7. **Close known gaps first** — Finish credit dashboard summary metric parity (partial fix in progress), then audit remaining credit surfaces (history, policy usage chart, report grids), then non-credit APIs.

## User Stories

1. As a collection agent on business unit +131, I want every screen to show only customers and invoices in my unit after login, so that I never see another unit's book by accident.

2. As a collection manager on parent business unit +130, I want the default view to aggregate all business units I can access, so that I get a portfolio view without picking a filter first.

3. As a collection manager on +130 with multiple child units, I want an optional business-unit dropdown on dashboards to drill into one unit, so that I can isolate performance when needed.

4. As a user with only one accessible business unit (+131), I want no business-unit picker anywhere, so that the UI stays clean and scope is implicit.

5. As a user on the primary business unit, I want unassigned customers (`business_unit_id = null`) included in my default scope, so that unassigned debt remains visible per existing rules.

6. As a leaf-BU user (+131), I want unassigned customers excluded from my scope, so that I only see customers explicitly in my unit.

7. As a credit insurance user on +131, I want Exposure Guard cards and credit reports scoped to my customers, so that capacity gap and terms breach match my unit.

8. As a credit insurance user on +131, I want the insurance policy selector to remain account-wide, so that I can still filter by policy while customer metrics stay in my unit.

9. As a user on +130, I want credit dashboard KPIs to match the sum of my accessible units when "All" is selected, so that numbers are consistent with customer lists.

10. As a user who tampers with `businessUnitId` in the URL to a unit I cannot access, I want HTTP 403, so that data cannot leak across units.

11. As an admin using View As on +131, I want business-unit scope to follow the viewed user's assignment, so that impersonation reflects their real access.

12. As an Archaser admin (account 10013), I want unrestricted account-wide access when not viewing as another user, so that support workflows are unchanged.

13. As a user on the customers list, I want rows limited to my business-unit scope, so that list behavior matches dashboards.

14. As a user on the invoices list, I want invoices filtered through customer business-unit scope, so that open AR in lists matches dashboards.

15. As a user on the activities list, I want activities scoped to accessible customers, so that call and email history does not cross units.

16. As a user running a saved report, I want report results to respect my business-unit filter, so that exports match what I see in the UI.

17. As a user using global search, I want hits limited to accessible customers and related entities, so that search does not surface cross-unit records.

18. As a user importing customers or invoices for +131, I want validation to reject rows assigned to another business unit, so that imports cannot bypass scope.

19. As a user exporting data on +131, I want only rows visible in my scope exported, so that exports align with list filters.

20. As a user on financial and operational dashboards, I want the same resolver semantics as credit, so that all three dashboards behave consistently (see linked dashboard BU PRD).

21. As a user on settings, I want tabs to remain gated by permissions only, not hidden by business-unit assignment, so that authorized +131 users can still open allowed settings.

22. As a Hebrew-speaking user, I want any new business-unit labels to go through the normal i18n approval process, so that translations stay controlled.

23. As a QA engineer, I want a manual matrix comparing +130 vs +131 on login, so that acceptance is repeatable.

24. As a developer, I want one resolver module tested in isolation, so that new APIs adopt scope without copying Prisma filter logic.

25. As a developer fixing credit dashboard, I want capacity gap and terms breach totals to use the same `businessUnitFilter` as customer queries, so that card numbers cannot drift from scoped lists.

26. As a product owner, I want the dashboard business-unit program to remain a vertical slice under this parent scope, so that dashboard dropdown work is not duplicated in requirements.

27. As a dual-product account user, I want collection and credit scopes to use the same business-unit rules, so that behavior is predictable across products.

28. As a user with no business unit assigned, I want to see no customer data (existing impossible-filter behavior), so that misconfigured users do not get account-wide access.

29. As a user refreshing a page, I want cached client data keyed to business-unit selection where applicable, so that stale unscoped metrics are not shown after filter changes.

30. As a security reviewer, I want penetration-style cross-BU access attempts to return 403 or empty results, so that horizontal privilege escalation is blocked.

## Implementation Decisions

### Primary seam (testing & architecture)

**Single deep module: business-unit scope resolution** (working name; may extend `DashboardBusinessUnitFilterService` rather than fork a second abstraction).

**Inputs:**

- Authenticated user context (`business_unit_id`, account id, View As overrides, admin flag)
- Account id for the request
- Optional `selectedBusinessUnitId` from query string (dashboards and bookmarkable routes)

**Outputs:**

- `customerFilter` — Prisma `CustomerWhereInput` ready to AND onto entity scopes
- `accessibleBusinessUnitIds` — user's BU + descendants; `null` for unrestricted admin
- `selectedBusinessUnitId` — null means "All accessible"
- `showBuPicker` — true only when more than one selectable unit exists for this user

**Adapters (thin):** API handlers parse session, call resolver once, pass `customerFilter` into services. List grids, report builder, credit dashboard services, and import validators consume the filter — they do not reimplement hierarchy or primary-BU null rules.

This is the **highest seam** for unit tests. Individual SQL aggregates and UI components are integration concerns.

### Filter semantics (unchanged from access control)

| Context | Behavior |
|---------|----------|
| **All** (no `businessUnitId` param) | User's BU + descendant ids; primary-BU users also see `business_unit_id = null` customers |
| **Specific BU id** | `{ business_unit_id: selectedId }` after validating id ∈ accessible set; excludes null-BU customers |
| **Invalid / out-of-scope id** | HTTP 403 |
| **Archaser admin (account 10013), not View As** | Empty filter (account-wide) |
| **View As** | Viewed user's `business_unit_id` drives resolver input |
| **Leaf user (+131), one accessible BU** | Same as "All" for that user — filter collapses to their single unit; `showBuPicker = false` |

### Relationship to dashboard business-unit PRD

The [dashboard business-unit filter PRD](dashboard-business-unit-filter.prd.md) is a **vertical slice** of this program: shared dropdown, URL param, and financial/operational/credit dashboard APIs. This PRD is the **parent** for app-wide enforcement. Do not duplicate dashboard-specific UI stories; link to that PRD for toolbar/dropdown behavior.

### Credit dashboard — known gaps and partial fix

**Bug reported:** +131 saw identical Capacity Gap (8,000), Terms Breach (8,500), etc. as +130.

**Root cause class:** `getCreditDashboardSummary` applied `businessUnitFilter` to customer queries but several aggregates ignored it:

- Capacity gap rollup (`sumCustomerPolicyCapacityGapForAccount`)
- Terms breach **total** (summed account-wide map instead of scoped aggregate)
- Terms breach outstanding fetches
- Zero limit warning count
- Top-up expiring alerts

**In-progress fix (uncommitted):** Pass `businessUnitFilter` into those paths; use scoped `invRow.t` for terms total when BU scope is active. Unit test added for capacity gap BU filter.

**Remaining credit work (out of partial fix):** Policy usage chart, summary history / trend snapshots per BU, report grid edge cases — track against dashboard BU PRD and credit-dashboard-bu-trend-history PRD where applicable.

### App-wide rollout order (suggested)

1. Land credit dashboard summary BU parity (partial fix + smoke +130/+131).
2. Generalize resolver (`showBuPicker`, accessible ids) if not already on dashboard service.
3. Audit entity list APIs (customers, invoices, activities, disputes) for missing `getBusinessUnitFilter` / `buildBusinessUnitFilterForTable`.
4. Report execution and export paths.
5. Global search.
6. Import/export validators (extend existing `BusinessUnitService` checks where gaps found).

### Settings and admin

**No business-unit-based hiding** of settings tabs in v1 — permissions (`view_settings`, `manage_business_units`, etc.) remain the only gate (grill decision).

### Schema and API

- **No new tables** for v1.
- **No new login flows** — scope is derived from existing `User.business_unit_id`.
- **Optional query param** `businessUnitId` on dashboard and bookmarkable drill-down routes (already specced for dashboards).
- Non-dashboard list APIs continue to use implicit scope from user assignment unless a future slice adds explicit narrowing.

### Grill-me decision log

| Topic | Decision |
|-------|----------|
| Problem shape | Enforce existing `User.business_unit_id`, not separate credentials per BU |
| v1 scope | App-wide |
| +131 (one BU) | Silent auto-scope — no picker, no badge |
| +130 (parent BU) | Aggregate accessible units by default; picker where multi-BU |
| Unassigned customers | Primary BU only (existing rule) |
| Credit | Customer metrics scoped; policy config account-wide |
| View As | Viewed user's BU |
| Enforcement | Central scope resolver |
| Settings/admin | Permissions only |
| Import/export | Existing BU validation; extend where missing |
| Archaser admin | Unrestricted |
| Verification | Manual +130 vs +131 matrix |

## Testing Decisions

### What makes a good test

Assert **observable scope behavior**: given user BU assignment and optional `businessUnitId`, API responses and aggregates include only customers/invoices in the allowed set. Do not assert internal Prisma call order or resolver implementation details in service tests.

### Primary module under test

**Business-unit scope resolver** — unit tests for:

- Leaf user → non-empty filter on single BU; `showBuPicker = false`
- Parent user, All → OR filter with descendants (+ null if primary)
- Parent user, specific child id → narrow filter; 403 for id outside tree
- Admin, All → empty filter
- View As → viewed user's BU drives filter

### Supporting tests

- **Credit dashboard summary** — with mocked prisma, assert capacity gap and terms breach paths receive `businessUnitFilter` when scope is active (extend gap rollup test pattern).
- **Integration smoke** — optional API tests for `/api/credit-insurance/summary` with mocked session + BU assignments.

### Acceptance (manual)

Compare **+130** vs **+131** on the same account:

| Surface | +130 expectation | +131 expectation |
|---------|------------------|------------------|
| Credit dashboard KPIs | Aggregated accessible units | Lower or equal; scoped to one BU |
| Customer list count | ≥ +131 count | Subset |
| Credit report drill-down | Matches dashboard scope | Matches dashboard scope |
| Import to wrong BU external id | Rejected | Rejected |
| Settings tabs | By permission | By permission |
| BU dropdown | Visible if multi-BU access | Hidden |

### Prior art

- `tests/unit/services/DashboardBusinessUnitFilterService.test.ts` — resolver validation and 403 cases.
- `tests/unit/creditInsurance/creditInsuranceDashboardService.gap.test.ts` — capacity gap rollup with BU filter.
- `tests/unit/services/BusinessUnitService.importValidation.test.ts` — import BU access.
- `docs/ADDITIONAL_PENETRATION_TESTS.md` — cross-BU access scenarios.

## Out of Scope

- Separate login credentials or SSO claims per business unit.
- Business-unit picker or read-only BU badge for single-BU users.
- Hiding settings/admin tabs based on BU assignment.
- Per-insurance-policy or per-business-unit notification rules (credit notifications PRD).
- Forcing parent-BU users (+130) to select a unit at login before any data loads.
- Changing primary-BU null-customer inclusion rules.
- Archaser admin restriction (account 10013 stays unrestricted).
- New translation keys without explicit approval.
- Making `businessUnitId` a global query param on every list page in v1 (implicit scope from user assignment is sufficient for lists; explicit param remains dashboard-focused unless a follow-up requests it).

## Further Notes

### Acceptance fixtures

**+130** and **+131** are the manual test pair: same account, different `User.business_unit_id` assignments (+130 = parent/primary with full accessible tree, +131 = single leaf unit). Verify in Admin → Users that +131 is assigned to the leaf business unit, not the primary unit — identical numbers often indicate misassignment as well as code gaps.

### Partial implementation status

An uncommitted fix addresses credit dashboard summary metrics that ignored `businessUnitFilter`. Full app-wide program and central resolver generalization are **not yet shipped**. Vertical slices are published in ClickUp (see **Issues** section below).

### Related plans

- [dashboard-business-unit-filter.prd.md](dashboard-business-unit-filter.prd.md) — dashboard dropdown and three dashboard stacks.
- [credit-dashboard-bu-trend-history.prd.md](credit-dashboard-bu-trend-history.prd.md) — per-BU daily snapshots for credit trends.
- [dev-mode-performance.prd.md](dev-mode-performance.prd.md) — unrelated; no dependency.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Login with bussiness unit credential](https://app.clickup.com/t/869dxvf3r)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Credit dashboard summary BU parity (+130 vs +131) | [869dy48xn](https://app.clickup.com/t/869dy48xn) | — | 7, 9, 23, 25 |
| 2 | Central business-unit scope resolver | [869dy48zp](https://app.clickup.com/t/869dy48zp) | — | 4, 10–12, 24, 29 |
| 3 | Credit dashboard remaining BU surfaces | [869dy4903](https://app.clickup.com/t/869dy4903) | 1 | 7, 16, 29 |
| 4 | Entity list APIs business-unit audit | [869dy490p](https://app.clickup.com/t/869dy490p) | 2 | 13–15 |
| 5 | Reports, search, and export BU scope | [869dy491g](https://app.clickup.com/t/869dy491g) | 2 | 16, 17, 19 |
| 6 | Import and export BU validation audit | [869dy4924](https://app.clickup.com/t/869dy4924) | 2 | 18, 19 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development per `.cursorrules`
