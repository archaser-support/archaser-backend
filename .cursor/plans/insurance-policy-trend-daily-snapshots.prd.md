---
name: insurance-policy-trend-daily-snapshots
overview: Daily cron snapshots of Primary insurance policy headers, per-country caps, and named-policy rows on credit-insurance accounts; read via scoped trend APIs for charts and config-change diffs.
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869dwn1k5
isProject: false
---

# Insurance Policy Trend Daily Snapshots

## Problem Statement

Credit insurance users need to see how an **insurance policy** (Primary) and its configuration — limits, terms, cost settings, country caps, named-customer rows, and portfolio rollups (active customers, approved limits, open AR, usage %) — change over time.

Live policy tables only reflect **today's** state. Without daily point-in-time records, trend charts and “what changed since yesterday?” views cannot be built reliably. Users cannot review historical policy configuration or usage trajectory when investigating limit breaches, reporting deadlines, or policy amendments.

The product needs a **cron-driven daily snapshot** model consistent with other credit-insurance trend data (credit dashboard daily snapshots, customer policy trend), not live recomputation on every read.

## Solution

1. **Nightly cron job** — `"Insurance Policy Trend Daily Snapshot"` runs once per calendar day (UTC), after insurance policy status maintenance, and upserts snapshot rows for every **effectively active Primary** insurance policy on accounts with credit insurance enabled.

2. **Three snapshot layers per run:**
   - **Policy header** — one row per `(insurance_policy_id, snapshot_date)` with scalar policy fields plus computed rollups (active customer count, total approved limit, total open AR, policy usage %, child row counts).
   - **Country rows** — one row per `(insurance_policy_country_id, snapshot_date)` capturing payment term cap, country MEP, reporting days, country max limit.
   - **Named-policy rows** — one row per `(named_policy_id, snapshot_date)` capturing customer number, terms, limits, expiration.

3. **Upsert semantics** — Re-running the job for the same calendar day overwrites that day's rows (no duplicates). Historical days are immutable once written unless manually backfilled.

4. **Read APIs** — Scoped GET endpoints return time series for header metrics, country trends, named-policy trends, and **config changes** (header field diffs plus added/removed country and named-policy ids between two snapshot dates).

5. **Cron-only writes** — No read-time sync on trend APIs (unlike the customer policy usage “top customers” endpoint). Today's data appears after the nightly cron completes.

6. **Primary-only scope** — TopUp policies are not snapshotted as separate series; TopUp cover is folded into Primary rollups where applicable.

## User Stories

1. As a credit insurance user, I want to see a multi-day trend of policy-level usage (open AR vs max cover), so that I can spot rising exposure on a Primary policy.

2. As a credit insurance user, I want to see how active customer count on a policy changed over the last 90 days, so that I can correlate portfolio growth with limit utilization.

3. As a credit insurance user, I want to see total approved limit trend for a Primary policy, so that I can understand aggregate limit changes driven by customer attachments and top-ups.

4. As a credit insurance user, I want historical snapshots to include top-up-adjusted approved limits when the account has TopUp policies, so that rollup trends match effective cover customers actually have.

5. As a credit insurance user, I want to review per-country cap and term history for a policy, so that I can see when country-specific limits or reporting days changed.

6. As a credit insurance user, I want to review named-customer row history (customer number, max limit, terms), so that I can audit named-policy configuration over time.

7. As a credit insurance user, I want to compare two snapshot dates and see which header fields changed, so that I can quickly identify policy amendments without diffing raw settings manually.

8. As a credit insurance user, I want config-change comparison to list countries or named rows added or removed between two days, so that structural policy changes are visible alongside scalar field edits.

9. As a credit insurance user with `view_credit_dashboard` permission, I want to access insurance policy trend data, so that dashboard-adjacent analysis does not require settings admin rights.

10. As a credit insurance user with `view_settings` or `update_insurance_policy` permission, I want to access insurance policy trend data, so that settings workflows can include historical context.

11. As a credit insurance user on an account without credit insurance enabled, I want trend APIs to reject access, so that snapshot data is not exposed outside the product surface.

12. As a credit insurance user requesting trend data for a policy outside my account, I want a not-found response, so that cross-account data cannot leak.

13. As a credit insurance user, I want to filter country trend series to one country id, so that charts for a single market are readable.

14. As a credit insurance user, I want to filter named-policy trend series by named-policy id or customer number, so that I can drill into one named row's history.

15. As a credit insurance user, I want to choose a lookback window between 7 and 365 days (default 90), so that charts can show quarterly or annual history without unbounded queries.

16. As a credit insurance user viewing trend data before the nightly cron has run today, I accept that today's date is absent from the series, so that all points represent the same batch snapshot moment.

17. As a credit insurance user whose Primary policy expired or was deactivated, I want historical trend points to remain queryable up to the last in-term snapshot day, so that past analysis is not lost when the policy stops.

18. As a credit insurance user whose Primary policy expired or was deactivated, I accept that no new snapshot rows are written after the policy leaves the effectively-active set, so that the series ends naturally on the last live day.

19. As a credit insurance user on an account with only TopUp policies and no effectively active Primary, I accept that no insurance policy trend rows are written until a Primary is effectively active, so that snapshot scope stays Primary-centric.

20. As an operations engineer, I want the cron job registered with timeout and alert settings, so that failed or slow snapshot runs are observable.

21. As an operations engineer, I want the snapshot runner to accept an optional snapshot date for manual backfill, so that a missed cron day can be repaired without code changes.

22. As an operations engineer, I accept permanent gaps in the series when a cron night is missed and not manually backfilled, so that v1 does not require automatic gap detection or retry loops.

23. As a developer, I want insurance policy status maintenance to run before snapshots, so that Draft→Active transitions and term-bound status are applied before rows are written.

24. As a developer, I want snapshot rows keyed by UTC calendar date, so that trend date boundaries are consistent with other credit-insurance daily snapshots.

25. As a developer, I want child country and named rows snapshotted in full each run (all current children), so that day-over-day presence diffs detect additions and removals without a separate change log.

26. As a developer, I want deleted child rows to retain prior daily snapshot rows, so that historical point-in-time data is preserved even after live configuration removes a country or named entry.

27. As a developer, I want hard deletion of an insurance policy to cascade-delete trend rows, so that orphaned snapshot data does not remain without a parent policy.

28. As a product owner, I want insurance policy trend storage to follow the same cron-write / stored-read pattern as credit dashboard daily snapshots, so that operational and performance characteristics are predictable.

29. As a QA engineer, I want unit tests on pure rollup helpers (policy usage percentage), so that math edge cases (null max cover, cap at 999.99%) are covered without database setup.

30. As a QA engineer, I accept export-only smoke tests for snapshot and reader functions in v1, consistent with customer policy trend service tests, so that test maintenance stays lightweight until integration tests are prioritized.

31. As a Hebrew-speaking user, I want any future UI built on these APIs to use existing i18n patterns, so that trend labels follow app conventions when surfaced in the product.

32. As an archaser admin using View As, I want trend APIs to respect the viewed account context, so that support and demo workflows see the correct account's history.

33. As a credit insurance user, I want policy usage percentage to be null when max total cover is missing or zero, so that misleading percentages are not shown.

34. As a credit insurance user, I want policy usage percentage capped at 999.99% when open AR far exceeds max cover, so that chart scales remain bounded.

35. As a credit insurance user switching between policies in a future trend UI, I want each policy's series to be scoped by policy id, so that multi-policy accounts can compare policies independently.

## Implementation Decisions

### Primary seam (testing & architecture)

**Insurance policy trend snapshot and read service** — a single service module that owns:

- **Write:** `takeInsurancePolicyTrendSnapshots({ snapshotDate? })` — iterates credit-insurance accounts, selects effectively active Primary policies, computes rollups, upserts header + country + named rows.
- **Read:** `getInsurancePolicyTrend`, `getInsurancePolicyCountryTrend`, `getNamedPolicyTrend`, `getInsurancePolicyConfigChanges` — query stored rows only; no write-on-read.

Cron job wrapper delegates to the write entry point and records execution steps for observability. API handler validates account, policy ownership, permissions, and routes by `scope` query param.

This is the **highest seam** for behavior verification: snapshot output shape, date filtering, config-change diff logic, and pure rollup helpers.

### Write path

- **Schedule:** `"Insurance Policy Trend Daily Snapshot"`, cron expression `15 3 * * *` (03:15 UTC daily), active by default, 1800s timeout.
- **Pre-step:** Run insurance policy status maintenance before selecting policies to snapshot.
- **Account filter:** `has_credit_insurance = true`.
- **Policy filter:** Primary only — status Active, `start_date <= snapshot_date`, `end_date >= snapshot_date` (effectively active Primary on snapshot date, UTC).
- **Snapshot date:** `startOfTodayUtc()` unless overridden for manual backfill.
- **Actor attribution:** `created_by` / `modified_by` = system cron actor identifier.
- **Conflict handling:** Upsert on unique keys:
  - Header: `(insurance_policy_id, snapshot_date)`
  - Country: `(insurance_policy_country_id, snapshot_date)`
  - Named: `(named_policy_id, snapshot_date)`

### Header rollup computation

For each snapshotted Primary policy:

- **Active customers:** Count active customer policies on the policy where customer collection status is Active or Inactive.
- **Open AR:** Sum open receivables per customer on the policy (via existing open-AR map helper).
- **Total approved limit:** Sum customer approved limits; when account has TopUp policies, use effective approved limit resolution as of snapshot date.
- **Policy usage %:** `100 × total_open_ar / max_total_cover`, null when max cover missing or ≤ 0, capped at 999.99.
- **Child counts:** Current count of country rows and named-policy rows on the live policy (stored as counts, not embedded JSON).

### Read path

- **Date range:** From `(todayUtc − days + 1)` through `todayUtc` inclusive; `days` clamped 7–365, default 90.
- **API scopes:**
  - `header` (default) — policy header time series + latest point.
  - `countries` — optional `countryId` filter.
  - `named` — optional `namedPolicyId` or `customerNumber` filter.
  - `changes` — optional `fromDate` / `toDate` (default yesterday vs today UTC); returns header scalar diffs and added/removed country and named-policy ids.
- **Permissions:** Any of `view_settings`, `update_insurance_policy`, or `view_credit_dashboard` on the account.
- **No read-time sync:** Readers never invoke the snapshot writer.

### Lifecycle on policy dropout

When a Primary policy no longer matches the effectively-active filter:

- **Stop** writing new snapshot rows (no terminal inactive-state snapshot).
- **Preserve** all prior snapshot rows for historical queries and config-change comparison.

### Grill-confirmed exclusions (v1)

| Topic | Decision |
|-------|----------|
| Read-time sync | No — cron-only writes |
| TopUp policy rows | No — Primary only; TopUp in rollups only |
| Missed cron days | Gap acceptable; optional manual `snapshotDate` rerun |
| Inactive terminal snapshot | No — series ends on last in-term day |
| Integration tests | No — export-only unit tests sufficient for v1 |

### Schema (existing)

Three daily snapshot tables with `snapshot_date` (DATE), account and policy foreign keys, audit columns, and unique indexes per entity per day. Policy header stores denormalized policy scalars plus rollup metrics; child tables store per-row configuration snapshots.

## Testing Decisions

### What makes a good test

- Test **observable behavior** at the service/API boundary: series date ranges, response shapes, config-change diff results, permission gates — not SQL string internals or private loop structure.
- Prefer **pure function tests** for rollup math where inputs and outputs are fully determined without DB (policy usage percentage).
- Match **prior art:** `customerPolicyTrendService` and `creditDashboardSnapshotService` use export smoke tests plus targeted pure-helper tests; this feature follows the same v1 bar.

### Modules under test

| Module / seam | What to test |
|---------------|--------------|
| Pure rollup helper | Usage % null cases, cap at 999.99%, normal percentage |
| Snapshot service (v1) | Export smoke — write and read functions exist |
| Config-change diff (future optional) | Header field diff and added/removed id sets given two snapshot payloads |
| API handler (future optional) | Scope routing, 403/404 for wrong account or missing credit insurance |

### Prior art

- `tests/unit/creditInsurance/insurancePolicyTrendService.test.ts` — export smoke + `computePolicyUsagePct` cases.
- `tests/unit/creditInsurance/customerPolicyTrendService.test.ts` — same export-only pattern for sibling trend service.
- Credit dashboard BU trend PRD — stored daily snapshots, forward-only history, no read-time backfill for past days.

### Explicitly not required in v1

- Integration test that seeds DB and asserts upserted row counts (deferred unless prod gaps appear).
- Cron manager end-to-end test (covered operationally via cron execution logs and alerts).

## Out of Scope

- **Read-time snapshot sync** on trend API calls (contrast: customer policy usage top-N endpoint).
- **Separate daily trend rows for TopUp** insurance policies.
- **Automatic backfill** when yesterday's cron failed.
- **Terminal snapshot** row when a policy becomes inactive or expires.
- **Retroactive backfill** of historical days before feature deploy.
- **UI components** for insurance policy trend charts (API exists; frontend consumption is a separate slice if not yet shipped).
- **Customer policy trend** changes — orthogonal daily snapshot system.
- **Credit dashboard summary trend** — separate snapshot table and PRD surface.
- **Integration / e2e cron tests** for this job in v1.
- **Translation file changes** until UI copy is defined.

## Further Notes

- **Cron ordering:** Insurance policy trend runs at 03:15 UTC, after credit dashboard (02:00) and customer policy trend (03:00), reducing concurrent load on credit-insurance aggregation helpers.
- **Today's gap until cron:** Users and any future UI should treat the latest available point as **yesterday or earlier** until after 03:15 UTC; this is intentional given cron-only writes.
- **Manual backfill:** Operations can rerun the snapshot function with `{ snapshotDate: <Date> }` to fill a missed calendar day; rerunning the same date is idempotent (upsert).
- **Config changes API:** Defaults to comparing yesterday vs today UTC snapshot dates; if either day is missing (gap or new policy), diff fields may be empty — consistent with gap-tolerant design.
- **Related trend systems:** Customer policy trend snapshots per-customer attachment metrics; credit dashboard daily snapshots account/BU summary KPIs. Insurance policy trend is the **policy-configuration and policy-level rollup** history layer.
## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Insurance Policy Trend Daily Snapshots](https://app.clickup.com/t/869dwn1k5)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Verify daily snapshot pipeline & trend API | [869dwq68t](https://app.clickup.com/t/869dwq68t) | — | 9–12, 16–24, 28–30, 33–34 |
| 2 | Policy header trend chart (settings) | [869dwq68z](https://app.clickup.com/t/869dwq68z) | 1 | 1–4, 15–18, 32, 35, 31 |
| 3 | Policy config changes & child trend drill-down | [869dwq693](https://app.clickup.com/t/869dwq693) | 1 | 5–8, 13–14, 25–26 |

*Slices 2 and 3 can run in parallel after slice 1.*

**Assignee / status:** Nilotpal Bose; Selected for Development
