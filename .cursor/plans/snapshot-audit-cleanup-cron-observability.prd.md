---
name: snapshot-audit-cleanup-cron-observability
overview: Remove meaningless created_by/modified_by from cron-written daily snapshot tables, fix cron jobs that falsely report SUCCESS on failure, and add Grafana alerts for failed cron executions.
source: grill-me session + to-prd synthesis
clickup_task_url: null
isProject: false
---

# Snapshot Audit Cleanup & Cron Failure Observability

## Problem Statement

Daily **snapshot** tables (policy trends, credit dashboard snapshots) are populated exclusively by **cron jobs**, not by human users. Despite that, five Postgres tables still carry `created_by` and `modified_by` columns that are always filled with synthetic machine identifiers (e.g. `system:insurance_policy_trend_cron`). These fields imply user attribution where none exists, add noise to INSERT/UPSERT statements, and create maintenance burden without business value.

Separately, when the **Insurance Policy Trend Daily Snapshot** cron failed to write records, **no Grafana alert fired**. Investigation showed a systemic issue: multiple cron job wrappers catch errors and return `{ success: false }` instead of re-throwing. The cron manager treats any non-throwing completion as **SUCCESS** — updating Prometheus metrics, MongoDB execution records, and `CronJob.last_run_at` accordingly. Existing Grafana rules only alert when jobs are **overdue** or **have not run in 24 hours**, not when a job **ran but failed**. Ops therefore had no automated signal for silent execution failures.

## Solution

1. **Drop `created_by` and `modified_by`** from all five cron-written daily snapshot tables in a single schema migration. Retain `created_at` and `modified_at` — they still record when a snapshot row was first written or last upserted, which is useful for debugging missed or backfilled days.

2. **Update snapshot services** so raw SQL INSERT/UPSERT no longer references the removed columns or synthetic actor constants.

3. **Fix cron failure signaling** by re-throwing errors from all cron job wrappers that currently swallow failures (~10 jobs). Let the existing `executeJobWithLogging` / `runCronJobs` path record FAILED status, increment `archaser_cron_job_executions_total{status="FAILED"}`, update MongoDB execution records, and trigger existing cron exception email notifications.

4. **Add Grafana alert rules** (Production and Staging) that fire when any cron job execution failure is recorded within a short window, complementing the existing overdue and stale-run alerts.

## User Stories

1. As a **platform engineer**, I want snapshot tables to omit user audit columns that are never populated with real users, so that the schema accurately reflects machine-generated data.

2. As a **platform engineer**, I want `created_at` and `modified_at` retained on snapshot rows, so that I can still determine when a daily snapshot was written or last refreshed.

3. As a **credit insurance developer**, I want all four policy trend snapshot tables cleaned up consistently, so that trend ingestion code does not carry redundant actor fields.

4. As a **credit insurance developer**, I want the credit dashboard daily snapshot table cleaned up in the same migration, so that all cron snapshot tables follow one pattern.

5. As an **ops engineer**, I want a failed Insurance Policy Trend snapshot run to be recorded as FAILED in cron execution history, so that I can distinguish “ran successfully with zero rows” from “ran and errored.”

6. As an **ops engineer**, I want Grafana to alert when any cron job records a FAILED execution, so that silent swallow-bug failures are caught without waiting 24 hours for a stale-run alert.

7. As an **ops engineer**, I want the re-throw fix applied to **all** cron wrappers with the same swallow pattern, so that other jobs (currency rates, gap computation, billing connector sync, etc.) do not suffer the same blind spot.

8. As an **ops engineer**, I want existing cron exception email notifications to continue firing on thrown errors, so that on-call is notified through channels already in use.

9. As a **developer**, I want snapshot cron wrappers to propagate service errors unchanged, so that stack traces and error messages in logs and MongoDB remain accurate.

10. As a **developer**, I want the schema migration delivered as hand-written SQL consistent with existing trend migrations, so that production rollout matches established database change practices.

11. As a **QA engineer**, I want unit tests proving snapshot cron wrappers re-throw when their service fails, so that the SUCCESS-on-failure regression cannot return unnoticed.

12. As a **QA engineer**, I want existing trend service unit tests updated to reflect SQL without audit columns, so that CI catches schema/service drift.

13. As a **product owner**, I want user-edited entities (Customer, CustomerPolicy, InsurancePolicy, Activity, etc.) to **keep** their `created_by` / `modified_by` audit columns, so that human attribution on business records is not affected.

14. As an **ops engineer**, I want Production and Staging Grafana alert parity for cron execution failures, so that staging catches misconfiguration before production.

15. As a **developer**, I want no API or UI changes for this work, so that the change remains a backend schema and reliability fix with minimal surface area.

16. As an **ops engineer**, I want the new Grafana alert to use the existing Prometheus metric `archaser_cron_job_executions_total` with `status="FAILED"`, so that alerting reuses instrumentation already emitted by the cron manager.

17. As a **developer**, I want synthetic `SNAPSHOT_ACTOR` constants removed from snapshot services once columns are dropped, so that dead code does not linger.

18. As an **ops engineer**, I want a failed snapshot run to **not** update `CronJob.last_run_at` as a successful completion, so that downstream “last run” dashboards reflect failure state correctly via the FAILED execution path.

## Implementation Decisions

### Schema — snapshot tables losing audit columns

Drop nullable `created_by` and `modified_by` (VARCHAR) from these Postgres models in one migration:

- `CustomerPolicyTrend`
- `InsurancePolicyTrend`
- `InsurancePolicyCountryTrend`
- `NamedPolicyTrend`
- `CreditDashboardDailySnapshot`

Retain `created_at` and `modified_at` on all five tables. No User FK relations exist on these columns today (they store plain strings, not foreign keys).

### Schema — tables explicitly unchanged

All other Postgres tables that carry `created_by` / `modified_by` with real User FK relations remain unchanged. User-edited credit insurance entities (`CustomerPolicy`, `InsurancePolicy`, etc.) continue to support human audit trails (including upcoming customer policy version history work).

### Snapshot service layer

The three credit-insurance snapshot services that write these tables via raw SQL must:

- Remove `created_by` and `modified_by` from INSERT column lists and VALUES.
- Remove `modified_by = …` from ON CONFLICT / upsert SET clauses.
- Delete the `SNAPSHOT_ACTOR` constants (`system:customer_policy_trend_cron`, `system:insurance_policy_trend_cron`, `system:credit_dashboard_snapshot_cron`) once unused.

Read/query paths for trends and dashboards do not expose these fields to APIs today; no response type changes expected.

### Cron failure signaling — re-throw pattern

**Decision:** Re-throw errors from job wrappers; do **not** add a parallel `success` check in the cron manager.

Affected cron job wrappers (all currently catch errors and return `{ success: false }`):

- Insurance Policy Trend Daily Snapshot
- Customer Policy Trend Daily Snapshot
- Credit Dashboard Daily Snapshot
- Compute Gap In Base Currency
- Fetch Currency Rates
- Compute Customer Overdue Metrics
- Process Due Notifications
- Handle Overdue Invoices
- Sync Billing Connectors
- Move Collection To Next Category

**Wrapper contract after change:**

- On success: return the existing success payload (message, summary, duration) as today.
- On failure: **re-throw** the caught error (or wrap and re-throw preserving message/stack). Do not return `{ success: false }`.

The cron manager’s existing error path will then:

- Set MongoDB `CronJobExecution.status` to `FAILED` or `TIMEOUT`.
- Increment `archaser_cron_job_executions_total{status="FAILED"}`.
- Invoke `sendCronExceptionNotification` (except where already excluded, e.g. Activity Workflow Manager — not in this list).
- **Not** mark the outer `runCronJobs` completion as SUCCESS.

Keep `stepCollector` ERROR steps in wrappers **only if** they run before re-throw (log context then propagate).

### Grafana alerting

Add a new alert rule to Production and Staging provisioning:

- **Condition:** `increase(archaser_cron_job_executions_total{status="FAILED", instance="<Env>"}[15m]) > 0`
- **Severity:** high (execution failure is actionable immediately).
- **Type label:** `cron` (consistent with existing cron alerts).
- **Annotations:** Summarize that one or more cron jobs failed execution; point ops to the cron dashboard and execution logs.

This complements — does not replace — existing `cron-jobs-overdue` and `cron-jobs-not-run-24h` rules.

### Migration delivery

- Hand-written SQL migration file under `prisma/migrations/` (consistent with existing trend table migrations).
- Sync `prisma/schema.prisma` to remove the two fields from the five models.
- Migration is idempotent-safe: `ALTER TABLE … DROP COLUMN IF EXISTS` for each column.

### Testing seam (primary)

**Highest seam:** the **cron job wrapper** boundary — mock the underlying service to throw; assert the wrapper propagates the error rather than resolving with `{ success: false }`.

This single seam covers the observability regression for all ~10 jobs without testing cron manager internals. One test module can parameterize over wrapper entry points or group snapshot wrappers separately from operational wrappers.

**Secondary seam:** snapshot **service** unit tests — verify exported functions still exist and pure helpers (e.g. usage percentage computation) remain correct; update any tests that assert SQL shape or column lists if added later.

No new integration test through full `runCronJobs` in this PR (agreed scope).

### Prior art

- Existing trend service unit tests under `tests/unit/creditInsurance/` (export smoke tests, `computePolicyUsagePct` behavior).
- `insurancePolicyStatusCron.test.ts` for cron-related unit patterns.
- Grafana cron alert rules: `cron-jobs-overdue`, `cron-jobs-not-run-24h` in `rules-production.yaml` / `rules-staging.yaml`.
- Cron execution metrics: `archaser_cron_job_executions_total` counter with `job_name` and `status` labels.

## Testing Decisions

### What makes a good test here

- Test **observable behavior at module boundaries**: wrapper propagates failure vs. falsely succeeding.
- Do **not** test cron manager Prometheus increments or MongoDB writes in unit tests — those are implementation details of `executeJobWithLogging`; re-throw is the contract that enables them.
- Do **not** test Grafana YAML syntax in unit tests; validate alert rules via manual/staging verification.

### Modules to test

| Module | Test focus |
|--------|------------|
| Snapshot cron wrappers (at minimum Insurance Policy Trend; ideally all three credit-insurance snapshot wrappers) | Service throws → wrapper rejects / re-throws |
| Trend service unit tests | Exports intact; update if SQL column assertions exist |
| Pure functions in trend services (e.g. usage pct) | Unchanged behavior |

### Manual verification (How to test)

1. **Schema:** After migration, confirm `\d "InsurancePolicyTrend"` (or Prisma introspection) shows no `created_by` / `modified_by`; `created_at` / `modified_at` remain.
2. **Snapshot cron:** Run Insurance Policy Trend Daily Snapshot for a credit-insurance account; confirm rows appear with timestamps but no audit-user columns.
3. **Failure path:** Temporarily break snapshot SQL (staging only) or mock a DB error; confirm cron execution record status = FAILED, Prometheus FAILED counter increments, exception email fires.
4. **Grafana:** Trigger or wait for a FAILED execution in staging; confirm new alert fires within ~15m window and routes through existing SNS contact point.
5. **Regression:** Confirm user-edited record saves still populate `modified_by` on `CustomerPolicy` / `InsurancePolicy` as before.

## Out of Scope

- Removing `created_by` / `modified_by` from user-edited or system tables outside the five daily snapshots.
- Adding `Insurance Policy Trend Daily Snapshot` to `SystemMonitoringService.checkCronJobFailures()` hardcoded job list (superseded by generic FAILED execution alert).
- Integration/e2e tests through full `runCronJobs` scheduler loop.
- Changing `created_at` / `modified_at` semantics on snapshot tables.
- Backfilling or deleting historical synthetic actor strings before column drop (columns dropped wholesale).
- UI changes to cron job monitor (FAILED records already visible if status is recorded correctly).
- Per-job Grafana alert rules for individual snapshot crons (using aggregate FAILED counter instead).
- ClickUp issue creation (run `/to-issues` separately).

## Further Notes

### Root cause summary (Insurance Policy Trend incident)

Three gaps stacked:

1. Job wrapper caught errors → returned `{ success: false }`.
2. Cron manager switch-case logged “completed” and outer `runCronJobs` marked SUCCESS without inspecting wrapper result.
3. No Grafana rule on `archaser_cron_job_executions_total{status="FAILED"}` — only overdue / not-run-24h.

Re-throw fixes (1) and (2) via existing infrastructure; new alert rule fixes (3).

### Relationship to Customer Policy Version History

The separate **customer-policy-version-history** PRD adds meaningful `modified_by` display on user-edited `CustomerPolicy` rows. This PRD is orthogonal: it removes **fake** user audit columns from **machine-written** trend/snapshot tables only.

### Deployment order

1. Deploy application code that stops writing dropped columns (can ship with migration if migration runs first in same release window).
2. Run SQL migration to drop columns.
3. Deploy Grafana rule changes and reload provisioning.

If migration runs before code, INSERTs that still reference dropped columns will fail — **deploy migration and code together** in one release.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Snapshot Audit Cleanup & Cron Failure Observability](https://app.clickup.com/t/869dwtj51)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Drop snapshot audit columns (schema + services) | [869dwtj6c](https://app.clickup.com/t/869dwtj6c) | — | 1–4, 10, 12, 13, 15, 17 |
| 2 | Cron wrappers re-throw on failure | [869dwtj6t](https://app.clickup.com/t/869dwtj6t) | — | 5, 7–9, 11, 18 |
| 3 | Grafana cron FAILED execution alert | [869dwtj72](https://app.clickup.com/t/869dwtj72) | #2 | 6, 8, 14, 16 |

**Assignee / status:** Nilotpal Bose · Selected for Development
