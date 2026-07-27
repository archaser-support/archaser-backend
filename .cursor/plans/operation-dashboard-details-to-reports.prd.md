---
name: operation-dashboard-details-to-reports
overview: Convert operation dashboard detail drills from fixed EndlessScroll lists into report-backed lists (saved views), phased by entity context, with exact KPI membership parity.
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869e3j00a
isProject: false
---

# Operation Dashboard Details → Report Lists

## Problem Statement

On the **operation dashboard**, KPI cards open a shared **details** page that shows the underlying rows for that drill (activities, disputes, or promises). That grid is a **fixed-column EndlessScroll list** fed by a custom details API—not a **report** (saved view).

Collection supervisors and agents who drill into operational KPIs cannot choose columns, save personal defaults, or reuse the report builder experience they already have elsewhere. The financial dashboard chart-details path already moved invoice/customer/payment drills onto report-backed lists; operation details still offer a weaker analysis tool for the same product pattern.

## Solution

1. **Report-backed operation details** — For the eight KPI cards currently shown on the main operation dashboard grid, replace the fixed EndlessScroll grid with a view-based report list on operation-scoped report contexts. Users get a report selector, system defaults, and create/edit of saved views (with existing report permissions).

2. **Contexts by row shape** — Three contexts:
   - **`dashboard_activities`** — Activity rows (manual, total-calls, activity-success-rate, system, portal)
   - **`dashboard_disputes`** — Dispute (CustomerDispute) rows (created, closed)
   - **`dashboard_promises`** — CustomerCollectionPeriod rows (promises-to-pay), matching today’s period-based list

3. **Locked drill-down filters** — Details URL parameters (`type`, date range, `businessUnitId`, and membership rules implied by the KPI) become **locked additional filters** always AND-merged with the selected report. Changing the saved view changes columns (and optional extra filters inside the slice); it does not widen past the KPI the user clicked.

4. **Exact KPI parity** — Row membership must match today’s operation-dashboard details API (including complex total-calls OR rules, system/portal user targeting, agent-set exclusion, promise period + related Promise_to_pay activity rules, dispute created/closed semantics).

5. **Server-side agent / system / portal scope** — `selectedUserId` and account-specific system/portal identity rules are applied on report execute for these contexts (same authorization posture as financial owner/BU scoping)—not trusted as client-only filters.

6. **List-only details chrome** — Keep the current details page layout (title + list + export). Do **not** add financial-style summary metric cards on the details page.

7. **Details-page only** — These contexts are not listed on the main Reports menu. Create/edit opens the report builder and returns to operation-dashboard details with the same drill params preserved.

8. **Permissions** — Users with **view operation dashboard** can execute/list/default these contexts even without **view reports**. Creating and editing saved views still requires normal report permissions.

9. **Phased rollout** — Activities end-to-end first, then disputes, then promises (including CustomerCollectionPeriod as a first-class report table). Dual-mode on the details page: report grid when convertible; otherwise keep EndlessScroll + the existing details API. Keep the legacy details API until all three contexts ship; then clean up converted branches.

10. **One system report per context** — Shared default columns per context; drills differ by locked filters. Users customize via saved views/builder.

## User Stories

1. As a collection supervisor, I want operation dashboard KPI drills to use saved views, so that I can analyze the same operational slice with columns I care about.

2. As a collection supervisor, I want a system default report for activities, so that the first open of an activity drill still feels familiar.

3. As a collection supervisor, I want a system default report for disputes, so that dispute created/closed drills open with useful default columns.

4. As a collection supervisor, I want a system default report for promises, so that promises-to-pay drills open with period amount/date/currency columns matching today’s list.

5. As a collection supervisor, I want the report selector on operation details, so that I can switch among system and personal views without leaving the drill-down.

6. As a collection supervisor with create-report permission, I want to create a custom report for `dashboard_activities`, so that I can save column layouts for recurring operational analysis.

7. As a collection supervisor with create-report permission, I want to create custom reports for `dashboard_disputes` and `dashboard_promises`, so that dispute and promise drills get the same flexibility.

8. As a collection supervisor with edit-report permission, I want to edit my custom operation-dashboard reports, so that I can refine them over time.

9. As a collection supervisor, I want system reports to be read-only, so that shared defaults cannot be accidentally broken.

10. As a collection supervisor, I want the Activity field catalog (including types needed for operational drills) available in the builder for `dashboard_activities`, so that I can add fields beyond the system default.

11. As a collection supervisor, I want clicking Manual Activities to lock the list to non-system-generated agent activities in the selected date/user/BU slice, so that switching reports cannot expand the KPI.

12. As a collection supervisor, I want clicking Total Calls to lock membership to the same Call / Promise_to_pay / Dispute-“filed” rules as today, so that call KPIs remain trustworthy.

13. As a collection supervisor, I want clicking Activity Success Rate to list the same activity set that underlies the rate, so that I can inspect successes and failures together.

14. As a collection supervisor, I want clicking System Activities or Portal Activities to lock to the account’s system or portal user activities, so that those KPIs stay exact.

15. As a collection supervisor, I want clicking Disputes Created / Disputes Closed to lock to today’s dispute membership (including agent/owner/modified-by and closed_at rules), so that dispute KPIs do not drift.

16. As a collection supervisor, I want clicking Promises to Pay to list CustomerCollectionPeriod rows with the same related Promise_to_pay activity constraints as today, so that promise counts and rows still agree with the card.

17. As a collection supervisor using the operation dashboard date range, I want details lists to respect that range, so that drills match the filtered dashboard.

18. As a collection supervisor using the user filter, I want details lists to respect `selectedUserId`, so that agent-scoped analysis matches the main dashboard.

19. As a collection supervisor using the business-unit filter, I want details lists to respect the selected business unit the same way today’s details API does, so that BU-filtered KPIs stay consistent.

20. As a user with operation dashboard access but without view-reports, I want to open converted details and scroll the report list, so that converting to reports does not revoke my existing ability to see drill-down data.

21. As a user without create/edit report permission, I want to use system (and any shared) reports on details, so that I still benefit from defaults without managing views.

22. As a collection supervisor, I want search/sort/export on the report list, so that operation details match other report-backed grids.

23. As a collection supervisor, I want export to honor the locked KPI filters and server-side agent/system/portal scope, so that exports match what I see on screen.

24. As a collection supervisor, I want non-converted detail types to keep working as EndlessScroll during phased rollout, so that disputes/promises (and orphan URL types) are not broken while activities convert.

25. As a collection supervisor creating a report from operation details, I want the builder to return me to the same details drill URL (type, dates, user, BU), so that I am not dropped onto an unrelated page.

26. As a collection supervisor, I want customer (and other existing) links in the list to open the usual detail pages, so that navigation from drills stays consistent with other lists.

27. As a collection supervisor, I want the main Reports menu to stay focused on primary report locations, so that operation-dashboard-only contexts do not clutter `/app/reports`.

28. As a product admin, I want system reports seeded for every account for each operation context, so that new and existing tenants get defaults.

29. As a product admin, I want new accounts to receive those system reports automatically, so that onboarding does not require manual SQL per tenant.

30. As a QA engineer, I want documented expected membership rules per drill type, so that parity with legacy details can be verified.

31. As a developer, I want a filter-mapping seam per context shared by locked report filters (and any future summary path), so that membership rules do not live only in UI branches.

32. As a developer, I want server-side execute scoping for selected user / system / portal / agent-set rules by drill type, so that authorization and KPI identity are not client-spoofable.

33. As a collection supervisor on mobile, I want the report list to remain usable in the existing details layout, so that drills still work on smaller screens without new bespoke styling.

34. As a collection supervisor, I want Activity Type Chart, Dispute Trend Chart, and Agent Stats Table to keep working unchanged, so that converting details does not disturb the main dashboard overview.

35. As a collection supervisor, I want orphan KPI cards that are not on the main grid to remain out of this conversion, so that scope stays focused on the eight wired cards users actually click today.

36. As a developer, I want Activity report metadata expanded (types/statuses/fields needed for filters and defaults) as part of the activities slice, so that locked filters and the builder catalog support exact operational membership.

37. As a developer, I want CustomerCollectionPeriod promoted to a first-class report table before or with the promises slice, so that `dashboard_promises` can execute with exact period-row parity.

38. As a developer, I want the legacy details API kept until all three contexts ship, so that dual-mode fallback remains safe during rollout.

39. As a developer, I want a final cleanup slice to remove converted details-API branches (or the endpoint if unused), so that two list implementations do not live forever.

40. As a collection agent, I want dispute and activity rows I am allowed to see under today’s rules to remain the same after conversion, so that report execute does not leak other agents’ operational data.

## Implementation Decisions

- **Target UI:** Use the existing view-based data grid (report selector + saved views) on operation-dashboard details for converted types—not EndlessScroll-only, and not a redirect into main Activities/Disputes report pages.

- **Contexts:** `dashboard_activities` (Activity), `dashboard_disputes` (Dispute / CustomerDispute), `dashboard_promises` (CustomerCollectionPeriod).

- **Wired drills in scope:**
  - Activities: `manual-activities`, `total-calls`, `activity-success-rate`, `system-activities`, `portal-activities`
  - Disputes: `disputes-created`, `disputes-closed`
  - Promises: `promises-to-pay`

- **Phasing:** Activities → Disputes → Promises. Dual-mode details page via `shouldUse*` helpers per context.

- **System reports:** One seeded system report per context (`unique_name` stable for copy-to-new-account). Auto-select by context (not eight seeds). Default columns should be a useful shared set; call-specific columns can be added by users via saved views.

- **Filter model:** Map details URL params + drill `type` to locked additional filters AND-merged with the selected report. Date range and type-specific membership live in the client-safe filter contract where expressible; agent/system/portal/selected-user identity rules are applied server-side on execute for these contexts.

- **Parity bar:** Exact match to current `getOperationDashboardDetails` membership for each converted type—including total-calls OR composition, system/portal user IDs, manual `system_generated` / agent exclusions, dispute created vs closed (including `closed_at` / modified_by semantics), and promises as periods with related completed Promise_to_pay activities in range.

- **Activity metadata:** Expand Activity report metadata (enums/fields such as full activity types, statuses, `system_generated`, creator fields, call-related fields as needed) in the activities slice so locked filters and builder usability support operational drills.

- **Promises foundation:** Add CustomerCollectionPeriod as a first-class report entity (metadata, relations, account scoping via Customer, date fields, QueryBuilder support). Extend relation filtering as needed so locked filters can express “has related Promise_to_pay activity …” with exact parity—or an equivalent execute-side seam that still shares the filter contract identity.

- **Permissions:** Execute/list/default allowed when the user has view operation dashboard **or** view reports for the three contexts. Create/edit/delete remain on existing report permissions.

- **Location:** Details-page only; not on the main Reports menu. Builder return preserves `type`, `startDate`, `endDate`, `selectedUserId`, `businessUnitId`.

- **Metric cards on details:** None—list-only chrome.

- **Legacy API:** Keep until all three contexts ship; then cleanup converted branches / unused endpoint.

- **Seeding:** SQL system-report seed for all accounts (same operational pattern as financial dashboard seeds), plus ensure new-account system-report copy preserves `unique_name`s.

- **Translations:** Prefer existing dashboard/activities/disputes copy; new report names may use English seed strings until translation edits are explicitly approved.

- **Styling:** Reuse existing grid/details patterns; no new visual system work unless separately approved.

## Testing Decisions

### What makes a good test

- Assert **external behavior**: given details URL params (and authenticated scope inputs), the locked filters / execute membership match the legacy details rules; permissions allow or deny as specified; the correct context/system report is selected for a `type`.
- Do **not** assert React component internals, private QueryBuilder AST shape, or pixel layout.

### Primary test seam (preferred: one high seam per context)

**Operation dashboard drill-down filter contracts** — pure (or near-pure) mappers from details URL/query inputs to locked filter sets and `shouldUse*` gates, one module per context (activities, disputes, promises), mirroring the financial dashboard invoice/customer/payment filter contracts.

Treat these contracts as the source of truth for URL → locked membership that the report list applies. Prefer extending this seam over adding many UI-only tests.

### Companion seam (authorization / identity)

**Execute scoping for operation dashboard contexts** — behavior-level tests that `selectedUserId` / system / portal / agent-set rules are applied server-side for these contexts (and that the permission exception is limited to these contexts), without asserting QueryBuilder internals.

Complex membership that cannot be expressed as ordinary additionalFilters alone (e.g. total-calls OR composition, CCP→Activity `some`) should still be identified by the filter contract (drill family / identity) and covered at the execute-scoping or dedicated membership helper seam—not only in UI.

### Modules / behaviors under test

- URL/query → locked filters for each wired drill type
- `shouldUse*` dual-mode gating (converted vs EndlessScroll)
- Execute/list permission: operation-dashboard-only user can run the three contexts; cannot use that exception for unrelated contexts
- Server-side selectedUser / system / portal / agent-set scoping by drill type
- System report selection by context
- Builder-return URL param round-trip for operation details
- AND-merge of locked filters with report config (existing view-execution tests / fixtures as prior art)
- Activity metadata completeness needed for type/status filters used by drills
- CustomerCollectionPeriod report-table foundation behaviors for the promises slice

### Prior art

- Financial dashboard chart-details → report lists (filter contracts, access helpers, builder return, view configs, seed SQL, unit tests under dashboard filter suites)
- Customer unpaid invoices: nested context + additional filters
- View execution / view-based grid report tests and report fixtures
- Dashboard business-unit filter resolution already used by operation details URLs

### Manual QA (still required)

- Each wired KPI: rows + export agree with pre-change expectations for date/user/BU combinations
- Report switch changes columns but not the KPI slice
- Create/edit returns to the same details drill
- Non-converted types unchanged during each phase
- Main dashboard cards, charts, and Agent Stats Table unchanged

### Test seam check

Primary seam proposed: **operation dashboard drill-down filter contracts** (per context) + **minimal execute permission/scoping checks** for the three operation contexts. Confirm or correct before `/to-issues` if this does not match expectations.

## Out of Scope

- Agent Stats Table on the main operation dashboard (stays as today)
- Activity Type Chart / Dispute Trend Chart drill behavior changes
- Wiring orphan KPI cards onto the main grid or converting their detail types (`automated-activities`, `open-disputes`, `undelivered-activities`, `overdue-follow-ups`, `missing-contacts`, `automation-stuck`)
- Adding summary metric cards to the operation details page
- Listing operation dashboard contexts on the main `/app/reports` menu
- Redirecting drills into main Activities/Disputes list pages instead of operation-dashboard details
- Financial dashboard chart-details work (already its own PRD program)
- Credit dashboard / Grafana
- Locale file edits without explicit approval
- New styling / theme work
- Weakening KPI parity to “best effort” report filters
- Removing the legacy details API before all three contexts have shipped

## Further Notes

- Closest product precedent: financial dashboard chart-details → report lists; secondary precedent: customer unpaid invoices nested report context.
- Related prior work: dashboard business-unit filter (URL `businessUnitId` must continue to flow into details and into report execute for parity where legacy applies).
- Financial PRD explicitly deferred operation dashboard details to a separate PRD—this is that follow-up.
- Promises are **not** Activity rows today; changing to Activity rows was rejected during grilling in favor of CustomerCollectionPeriod parity.
- System/portal user IDs are account-specific and must be resolved at execute time—do not hardcode in seed SQL locked filters.
- Implementation detail plan (file-oriented) may live alongside this PRD as `.cursor/plans/operation-dashboard-details-to-reports.plan.md` when authored.
- After this PRD is approved, run **`/to-issues`** to publish vertical slices to ClickUp (do not create tracker tasks from this skill).

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Operation Dashboard Details → Report Lists](https://app.clickup.com/t/869e3j00a)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Prefactor: dashboard_activities filter contract + execute scoping | [869e3j00w](https://app.clickup.com/t/869e3j00w) | — | 10, 17–20, 28–32, 36 |
| 2 | Activity drills as report list on operation details | [869e3j00z](https://app.clickup.com/t/869e3j00z) | 1 | 1–2, 5, 11–14, 22–24, 26, 33–35 |
| 3 | Create/edit operation activity reports + builder return | [869e3j010](https://app.clickup.com/t/869e3j010) | 2 | 6, 8–9, 21, 25, 27 |
| 4 | Disputes created/closed as report list | [869e3j016](https://app.clickup.com/t/869e3j016) | 1, 3 | 3, 7, 15 |
| 5 | Prefactor: CustomerCollectionPeriod report table for promises | [869e3j01c](https://app.clickup.com/t/869e3j01c) | 1 | 37 |
| 6 | Promises to pay as report list | [869e3j01k](https://app.clickup.com/t/869e3j01k) | 5, 3 | 4, 7, 16 |
| 7 | Cleanup: retire converted operation details API branches | [869e3j01m](https://app.clickup.com/t/869e3j01m) | 2, 4, 6 | 38–39 |

**Assignee / status:** Nilotpal Bose; Selected for Development

*Soft ordering:* slice 4/6 can refine dual-mode patterns from earlier UI slices; hard blockers are only the Waiting-on relationships above. Related prior art: [Financial Dashboard Chart-Details → Report Lists](https://app.clickup.com/t/869e3hmku).
