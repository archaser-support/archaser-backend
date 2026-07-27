---
name: credit-dashboard-bu-trend-history
overview: Multi-day credit dashboard summary trend history and month-over-month percentages scoped by business unit, backed by per-BU daily snapshots and read-time aggregation for non-admin "All".
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869dw45hd
isProject: false
---

# Credit Dashboard Business Unit Trend History

## Problem Statement

The credit dashboard shows a **summary trend chart** and **month-over-month percentage** on metric cards, driven by daily snapshots stored at account (and optional policy) scope. When business-unit filtering was added to the credit dashboard, summary KPIs and reports correctly narrow to the selected scope — but **trend history does not**.

Today, whenever the business-unit customer filter is non-empty, the history API returns only **one live data point for today** instead of a multi-day series. That affects not only users who pick a specific business unit from the dropdown, but also non-admin users on **"All"** (parent business-unit users whose implicit access filter is non-empty). The trend chart appears flat or empty while summary cards show the correct scoped totals.

Users who filter the credit dashboard by business unit need trend lines and MoM percentages that match the same customer scope as the summary cards — for both **All** (accessible units aggregated) and a **specific unit** — without waiting for inaccurate retroactive backfill.

## Solution

1. **Per-business-unit daily snapshots** — Extend the existing credit dashboard daily snapshot cron to write one row per active business unit on the account, for each existing policy scope (portfolio + per-policy), using the same summary calculation already used for account-wide rows but with `{ business_unit_id: buId }` customer scope.

2. **Schema extension** — Add a nullable `business_unit_id` column to the daily snapshot table and update the unique index to include it. Existing rows remain account-wide (`business_unit_id` null) for archaser admin **All**.

3. **History read path** — Replace the single-point fallback with scope-aware reads:
   - **Archaser admin, All** — Read existing account-wide snapshot rows (`business_unit_id` null).
   - **Archaser admin, specific BU** — Read rows for that `business_unit_id`.
   - **Non-admin, specific BU** — Read rows for that `business_unit_id`.
   - **Non-admin, All** — Read rows for all accessible business unit ids, **aggregate per snapshot date** (sum amounts and counts; recompute health index from summed compliant exposure ÷ total receivables). Do **not** use legacy account-wide rows (wrong scope).

4. **Forward-only history** — No retroactive backfill. BU-scoped series accumulate from the first cron run after deploy (1 point on day 1, growing to 14/30). Charts show whatever points exist; month-over-month % stays null until the existing minimum daily span is met.

5. **Unchanged surfaces** — Top-customer policy usage (current day only) and insurance-policy trend remain as today. This PRD covers **summary-history** and derived **monthPct** only.

**Depends on:** Dashboard business-unit filter resolver and credit dashboard `businessUnitId` query param wiring from the parent [Dashboard Business Unit Filtering](.cursor/plans/dashboard-business-unit-filter.prd.md) work (ClickUp parent [869dw4213](https://app.clickup.com/t/869dw4213)).

## User Stories

1. As a collection manager with multiple accessible business units, I want the credit dashboard trend chart to show multiple days of history when I select a specific business unit, so that I can see how that unit's credit health is changing over time.

2. As a collection manager with multiple accessible business units, I want the credit dashboard trend chart on **All** to reflect my accessible units aggregated, so that the trend matches the summary cards I see by default.

3. As a collection agent assigned to a single leaf business unit, I want trend history scoped to my unit even when I do not change the dropdown, so that I am not shown account-wide history that includes customers I cannot access.

4. As a credit insurance user who selects a business unit, I want month-over-month percentages on metric cards to use the same scoped history as the trend chart, so that deltas are consistent across the page.

5. As a credit insurance user who selects a business unit, I want today's point on the trend chart to align with the live summary cards, so that the most recent day is not misleading.

6. As a collection manager on **All**, I want trend history built from per-business-unit snapshots aggregated for my accessible set, so that I do not see account-wide history that includes units outside my access.

7. As an archaser admin with **All** selected, I want trend history to remain account-wide using existing snapshot rows, so that admin overview behavior is unchanged.

8. As an archaser admin who selects a specific business unit, I want trend history for that unit only, so that I can inspect one unit's trajectory without impersonation.

9. As a user who switches between daily and weekly trend intervals, I want BU-scoped history to respect the same interval rules as today, so that chart behavior is familiar.

10. As a user who switches insurance policy scope on the credit dashboard, I want BU-scoped trend history to respect the selected policy filter, so that policy drill-down and trend lines stay aligned.

11. As a user viewing the credit dashboard shortly after this feature ships, I want to see a growing trend line (even if only a few days at first), so that I understand history is accumulating rather than broken.

12. As a user viewing BU-scoped history before a full month of snapshots exists, I want month-over-month percentages to stay empty until enough days exist, so that I am not shown misleading partial-month comparisons.

13. As a primary-business-unit user on **All**, I want summary cards to continue including customers with no business unit assigned, so that unassigned customers remain visible per existing access rules.

14. As a primary-business-unit user on **All**, I accept that trend history excludes unassigned customers from the aggregated series, so that snapshot storage stays simple without a separate unassigned bucket.

15. As a user who bookmarks a credit dashboard URL with `?businessUnitId=`, I want trend history to respect that parameter, so that shared links preserve chart scope.

16. As a user using View As, I want BU-scoped trend history to follow the viewed user's accessible business units, so that View As reflects what that user would see.

17. As a user who tampers with `businessUnitId` in the URL to an id I cannot access, I want the history API to reject the request with 403, so that historical data cannot be leaked across business units.

18. As a developer, I want one history read module that routes by admin flag, selected business unit id, and accessible unit ids, so that routing rules are not duplicated across API handlers.

19. As a developer, I want the daily snapshot cron to write per-BU rows for all active business units on credit-insurance accounts, so that read paths have predictable data regardless of which units currently have customers.

20. As a product owner, I want BU trend history to use stored daily snapshots rather than live recomputation of past days, so that performance and consistency match the existing account-wide history model.

21. As a product owner, I want no retroactive backfill of BU history, so that we do not ship approximate historical data based on today's business-unit assignments.

22. As an operations engineer, I want the snapshot cron write volume increase to be bounded and observable, so that we can monitor job duration after enabling per-BU rows.

23. As a QA engineer, I want automated tests on the history reader's public output (series shape, aggregation, health index recompute), so that regressions in BU routing are caught without brittle query assertions.

24. As a Hebrew-speaking user, I want no new UI copy for this feature beyond existing trend chart labels, so that i18n scope stays minimal.

25. As a user on the credit dashboard report drill-downs, I want report grids to continue using live BU filtering independently of snapshot history, so that report behavior is unaffected by this change.

## Implementation Decisions

### Primary seam (testing & architecture)

**Credit dashboard BU-scoped summary history resolution** — a single service-layer entry point (the existing summary history function, extended) that:

- Accepts account id, policy scope, day range, interval, **selected business unit id** (null = All), **isAdmin**, and **accessible business unit ids** (for non-admin All aggregation).
- Returns the same response shape as today: `series`, `delta`, `monthPct`, `interval`.
- Routes to the correct snapshot query or aggregation path; **does not** use a non-empty customer filter alone as a signal to return a single live point.

The dashboard business-unit filter resolver remains the seam for **403 validation** and customer-scope filters on live summary/reports; this PRD adds a **second seam** focused on **historical series** read and aggregation. Cron snapshot writing is tested indirectly through history reader integration or a narrow cron-scope helper if extracted.

### Snapshot storage

- Add nullable `business_unit_id` to `CreditDashboardDailySnapshot`.
- Update unique constraint to `(account_id, policy_id, business_unit_id, snapshot_date)` with null-safe coalescing consistent with existing policy id handling.
- **Account-wide rows** (`business_unit_id` null): continue for archaser admin All; written by existing cron path unchanged.
- **Per-BU rows**: cron iterates all **active** business units on the account; for each BU and each existing policy scope (portfolio null + each effectively active policy), compute summary with `{ business_unit_id: buId }` and upsert.

### History read routing

| Actor | Selection | Read behavior |
|-------|-----------|---------------|
| Archaser admin | All | Account-wide rows (`business_unit_id` null) |
| Archaser admin | Specific BU | Rows for that `business_unit_id` |
| Non-admin | Specific BU | Rows for that `business_unit_id` |
| Non-admin | All | Rows where `business_unit_id` IN accessible ids; aggregate per `snapshot_date` |

**Remove** the early return that emits a single live point when any business-unit customer filter is present. Route on **selected business unit id** and admin flag instead.

### All aggregation (non-admin)

For each `snapshot_date` in range:

- **Sum** additive numeric fields (receivables, exposures, amounts, counts).
- **Merge** JSON count-by-reason maps by summing per key where applicable.
- **Recompute** `healthIndex` as `(100 × summedCompliantExposure) / summedTotalReceivables`, clamped 0–100; use 100 when total receivables is 0 (same rule as live summary).
- Apply existing weekly aggregation and chart window slicing after daily series is built.

### Null-BU customers (accepted tradeoff)

- **Summary cards (live):** unchanged — primary-BU users on All still include unassigned customers per parent PRD.
- **Trend history:** unassigned customers are **excluded** from snapshot rows and from All aggregation. No separate unassigned snapshot bucket in this release.
- Document this intentional divergence between live summary and historical series for primary users on All.

### Forward-only / partial history UX

- No backfill job for past days before deploy.
- Return sparse series (1–N points) as snapshots accumulate.
- `monthPct` uses existing minimum span rule (~25 days); returns null until met.
- No blocking banner or placeholder that hides the chart.

### API contract

- No new endpoints. Existing `GET /api/credit-insurance/summary-history` continues to accept `businessUnitId`, `policyId`, `days`, `interval`.
- Authorization and 403 behavior unchanged via existing credit dashboard access + filter resolver.
- Response shape unchanged.

### Cron impact

- Write multiplier per account: roughly `active_business_unit_count × (1 + active_policy_count)` additional rows per day, plus existing account-wide rows.
- Monitor job duration; no change to cron schedule required for MVP.

### Grill-me decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | Trend surfaces | Summary trend chart + monthPct only |
| D2 | Data strategy | Per-BU daily snapshots via extended cron |
| D3 | Non-admin All | Fix history for both All and specific BU |
| D4 | Backfill | Forward-only |
| D5 | Schema | Add `business_unit_id` to daily snapshot table |
| D6 | All aggregation | Sum amounts/counts; recompute healthIndex from totals |
| D7 | Null-BU customers | Exclude from snapshot history (ignore unassigned) |
| D8 | Cron BU set | All active business units on the account |
| D9 | Admin All | Keep existing account-wide rows |
| D10 | Partial history UX | Sparse chart; monthPct null until min span |

## Testing Decisions

**Principle:** Test **external behavior** of the history reader — given account shape, admin flag, selected business unit id, accessible unit ids, policy scope, and seeded snapshot rows, assert the returned `series`, `delta`, and `monthPct` without asserting SQL or Prisma internals.

**Primary module under test:** Credit dashboard summary history reader (extended `getCreditDashboardSummaryHistory` or extracted helper with the same public contract).

**Reader cases:**

| Scenario | Snapshots seeded | Expected |
|----------|------------------|----------|
| Admin, All | Account-wide rows only | Same series as today (regression) |
| Admin, specific BU | Per-BU rows for unit A | Series from unit A rows only |
| Non-admin, specific BU | Per-BU rows for unit A | Series from unit A rows only |
| Non-admin, All | Per-BU rows for units A + B (accessible) | Aggregated daily series; healthIndex recomputed |
| Non-admin, All | Account-wide rows only (legacy) | Empty or not used — must not return account-wide data |
| Specific BU, forward-only | Single day of BU rows | Series length 1; delta from one point |
| All aggregation | Two BU rows same date | Summed amounts; healthIndex = compliant sum / total sum |
| Weekly interval | 14+ daily BU rows | Weekly buckets match existing aggregation rules |
| monthPct | < 25 days of BU rows | monthPct fields null |
| monthPct | 30+ days of BU rows | monthPct computed from first/last daily point |

**Cron / integration (sample):**

- After cron scope helper runs for a fixture account with 2 BUs, per-BU rows exist for each policy scope.
- Summary-history API returns multi-point series when `businessUnitId` is set and snapshots exist.

**Prior art:** Existing credit dashboard snapshot service tests if present; dashboard business-unit filter resolver tests from parent slice; `customerPolicyTrendService` tests for snapshot patterns.

**Out of test scope for unit layer:** Full cron job E2E, chart SVG rendering, exact cron job wall-clock performance, Hebrew RTL layout.

## Out of Scope

- Retroactive backfill of BU-scoped history before deploy.
- Separate snapshot bucket for customers with no business unit (follow-up if summary/history parity is required).
- Multi-day history for top-customer policy usage chart.
- Insurance-policy trend filtering by business unit (policies remain account-scoped).
- Changes to live `getCreditDashboardSummary` semantics or adding `asOfDate` for historical recomputation.
- Financial or operational dashboard trend/history (unaffected).
- New UI copy or translations (no new strings expected).
- ClickUp task creation (use `/to-issues` when ready).

## Further Notes

### Relationship to parent PRD

This work completes **user story 30** and the history portion of **user story 15** from [dashboard-business-unit-filter.prd.md](.cursor/plans/dashboard-business-unit-filter.prd.md). It can ship as **slice 4** after the filter resolver (slice 1) and alongside or after credit dashboard BU filter UI/API wiring (slice 3). Slice 3 may land with single-point history as an interim state; this slice replaces that stub.

### Suggested implementation order

1. Schema migration (`business_unit_id` + unique index).
2. Extend daily snapshot cron to write per-BU rows.
3. Implement history read routing + All aggregation; remove single-point fallback.
4. Wire accessible business unit ids from credit dashboard API access into history reader.
5. Unit tests for reader cases above.
6. Verify credit dashboard page query keys already include `selectedBusinessUnitId` (no UI change expected if slice 3 is done).

### Risk

- Cron write amplification on accounts with many business units and policies.
- First 14 days after deploy: BU-filtered charts look sparse — expected per D10.
- Primary-BU users on All: live summary includes unassigned customers but trend history does not (D7 tradeoff).

### Testing seam confirmation

The **highest seam for this feature** is the **credit dashboard BU-scoped summary history reader** (one public function, series in / series out). The filter resolver stays the seam for access control; do not merge history aggregation into the resolver.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Credit dashboard BU trend history (end-to-end) | [869dw45hd](https://app.clickup.com/t/869dw45hd) | [BU filter foundation (869dw426h)](https://app.clickup.com/t/869dw426h) | 1–12, 15–18, 20–23, 7–8, 17 |

**Related (non-blocking):** [Dashboard Business Unit Filtering](https://app.clickup.com/t/869dw4213), [Credit dashboard BU filter (full scope)](https://app.clickup.com/t/869dw427f)

**Assignee / status:** Nilotpal Bose; Selected for Development per `.cursorrules`
