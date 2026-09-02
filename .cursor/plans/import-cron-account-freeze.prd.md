---
name: import-cron-account-freeze
overview: While file import, billing connector sync, admin as-of backfill, or post-import work is active on an account, worker crons skip that account so ingest and scheduled jobs do not race on the same invoices and insurance fields.
source: grill-me sessions (import vs cron overlap; transaction timeout on syncCustomerInsuranceFields)
clickup_task_url: null
isProject: false
---

# Import / sync account freeze for worker crons

## Problem Statement

File import and billing connector sync write invoices, payments, customer rollups, and credit-insurance fields incrementally over minutes or hours. Worker cron jobs run on a global schedule and currently **do not check** whether an account is mid-import. Jobs such as **Process Overdue Invoices** and **Compute Customer Overdue Metrics** can flip invoice status, call `syncCustomerInsuranceFields`, open collection periods, send notifications, and update snapshots on the same customers and rows while import is still landing.

That overlap causes database contention (including Prisma interactive transaction timeouts), transient wrong overdue/MEP/capacity-gap state, and hard-to-debug races between ingest and scheduled maintenance. The only existing skip today is for admin portfolio as-of backfill on the as-of rewrite **drain** — not a general import guard.

Operators expect import and sync to own the account until ingest and follow-up refresh finish. Scheduled work for other accounts must continue unaffected.

## Solution

Introduce a shared **account freeze** concept: an account is frozen while any authoritative “import or refresh in progress” signal is active. Almost every worker cron loads the frozen account set once per run and **skips** those accounts; all other accounts process normally.

**Freeze signals (account is frozen when any is true):**

1. **File import** — any `ImportJob` for the account with status `Processing`. For Invoice/Payment jobs, status stays `Processing` until the post-import orchestrator finishes, then moves to `Completed` (not before).
2. **Billing connector sync** — MongoDB sync history execution for the account with status `RUNNING`, including deferred post-import tail work. `completeExecution` runs only after post-import finishes, not when entity ingest alone completes.
3. **Admin as-of backfill** — `CreditAsOfBackfillJob` for the account with status `running` or `paused` (same rule as today’s rewrite drain skip).

**Cron behavior:**

- **Per-account skip** — frozen accounts are omitted; the cron continues for everyone else.
- **Full account freeze** — all account-scoped worker crons respect the freeze (collection notifications, activity workflow, category moves, automated collection periods, AR/insurance jobs, sync history repair crons, etc.).
- **Exemptions** — only **Fetch Currency Rates** bypasses the freeze (system-wide FX, no account AR writes).
- **Customer Policy Trend Daily Snapshot** — the entire handler is **exempt** from the freeze so its AR post-ingest retry drain and as-of rewrite drain can finish deferred connector post-import without deadlock; snapshot portions of that job may still run during import (accepted tradeoff).
- **Sync Billing Connectors** — must not **start** a new scheduled sync for a frozen account; must also skip if a connector execution is already `RUNNING` for that account.

**Import API guard:** reject starting a second file import (`createJob` or first batch) while any `ImportJob` on the account is `Processing`, returning **HTTP 409 Conflict** with code `IMPORT_IN_PROGRESS`.

**Connector RUNNING reliability:** add progress **heartbeats** (at least once per minute while active). Stale sweeper marks `TIMEOUT` only after **2 hours without heartbeat**, not wall-clock age from `started_at`.

**Observability:** structured log per cron run listing skipped frozen account IDs/count; Prometheus counter `archaser_cron_accounts_skipped_frozen_total{job_name}`.

## User Stories

1. As an accounts receivable clerk running a file import, I want scheduled crons to skip my account until import and post-import finish, so that my rows are not flipped to Overdue or recalculated mid-batch.
2. As a billing connector operator running a long backfill, I want worker crons to skip my account until sync and deferred post-import complete, so that a 6-hour ingest is not interleaved with daily overdue processing.
3. As a billing connector operator, I want sync history to stay `RUNNING` until post-import finishes, so that freeze state matches what the UI shows and crons stay away for the full tail.
4. As a billing connector operator, I want long backfills to heartbeat progress every minute, so that a multi-hour run is not falsely marked TIMEOUT at 2 hours wall-clock.
5. As a credit analyst, I want **Compute Customer Overdue Metrics** to skip frozen accounts and continue for others, so that one importing tenant does not block insurance maintenance for the whole platform.
6. As a collections manager, I want **Process Due Notifications** and **Activity Workflow Manager** to skip frozen accounts, so that collection emails and sequence steps do not fire on half-imported AR.
7. As a collections manager, I accept that notifications and workflow steps for a frozen account wait until unfreeze, so that messaging matches settled invoice status.
8. As an operations engineer, I want **Process Overdue Invoices** to skip frozen accounts, so that Due → Overdue flips do not race with import (the original timeout failure mode).
9. As an operations engineer, I want **Close Zero Outstanding Debt Invoices** and **Fix Closed Collection Data** to skip frozen accounts, so that Paid transitions and insurance refresh do not run on partial data.
10. As an operations engineer, I want **Compute Gap In Base Currency** and credit snapshot crons to skip frozen accounts, so that dashboard and trend snapshots are not taken on unstable mid-import AR.
11. As an operations engineer, I want **Sync Billing Connectors** not to start a new sync on a frozen account, so that file import and connector ingest never run in parallel on the same account.
12. As an operations engineer, I want **Fetch Currency Rates** to keep running during imports, so that FX tables stay fresh for unfrozen accounts and reporting.
13. As an operations engineer, I want **Customer Policy Trend Daily Snapshot** to keep running its post-import retry drain even when accounts are frozen, so that deferred connector post-import completes and Mongo RUNNING can clear.
14. As an operations engineer, I accept that trend snapshots inside that exempt cron may run during import for frozen accounts, so that we avoid a drain deadlock.
15. As an accounts receivable clerk, I want the API to reject a second import while one is Processing with HTTP 409, so that I cannot accidentally start overlapping file jobs on the same account.
16. As a frontend developer, I want a stable error code `IMPORT_IN_PROGRESS` on 409, so that the UI can show “import already running” without parsing free text.
17. As an accounts receivable clerk importing Invoice/Payment files, I want the job to stay Processing until post-import orchestrator finishes, so that crons treat the account as frozen through replay, overdue flip, and live MEP/gap refresh.
18. As an accounts receivable clerk importing Customer/Contact/Policy files, I want the job Processing only during batch upload (no long post-import), so that unfreeze happens soon after Complete without unnecessary delay.
19. As a credit operations user running admin portfolio as-of backfill, I want that job to continue blocking the same account for rewrite drain and now for all other crons too, so that behavior stays consistent with today’s drain skip extended platform-wide.
20. As an operations engineer, I want frozen-account skips logged with account IDs and counts, so that I can tell “skipped due to import” from “nothing to do.”
21. As an operations engineer, I want a Prometheus metric for skipped frozen accounts per cron name, so that Grafana can alert on sustained skip storms or verify freeze is working.
22. As a platform engineer, I want one shared helper that resolves frozen account IDs from Postgres and Mongo, so that every cron uses the same rules and drift is impossible.
23. As a platform engineer, I want cron handlers to load the frozen set once per run and filter queries or loops, so that per-account skip is cheap and consistent with D6-style behavior.
24. As a developer, I want connector sync completion delayed until deferred post-import drain finishes when deferral is enabled, so that D9 does not require a separate retry-queue freeze signal.
25. As a developer, I want the stale RUNNING sweeper to use last heartbeat time with a 2-hour idle threshold, so that crashed workers eventually unfreeze the account but active long backfills do not.
26. As a support engineer, I want frozen accounts to unfreeze automatically when import completes, sync completes, post-import completes, or admin as-of backfill ends, so that no manual “unlock account” step is required.
27. As a QA engineer, I want to verify that starting file import causes Process Overdue Invoices to skip that account on the next cron tick, so that the primary regression is observable.
28. As a QA engineer, I want to verify unfreeze after import Complete (including post-import for Invoice jobs), so that the next cron run processes the account again.
29. As a QA engineer, I want to verify a second createJob returns 409 while Processing, so that concurrent import is blocked.
30. As a QA engineer, I want to verify Sync Billing Connectors does not enqueue sync for an account with Processing ImportJob, so that connector and file paths do not overlap.
31. As a QA engineer, I want to verify Fetch Currency Rates still runs when any account is frozen, so that the FX exemption is preserved.
32. As a QA engineer, I want to verify Customer Policy Trend cron still drains AR post-ingest retry rows for a frozen account, so that deferred backfill post-import is not starved.
33. As a product owner, I want no translation file changes for this delivery, so that rollout stays backend/worker only unless UI later surfaces 409.
34. As a product owner, I want this PRD separate from post-import orchestrator behavior, so that freeze logic can ship as an additive guard without redefining ingest order.

## Implementation Decisions

### Decision log (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Overall strategy | Full freeze on account-scoped crons |
| D2 | Active signals | ImportJob Processing, Mongo RUNNING, admin as-of backfill running/paused, through post-import |
| D5 | File post-import signal | Delay Complete — Processing until orchestrator finishes |
| D6 | Skip granularity | Per-account skip; continue other accounts |
| D7 | Observability | Log + Prometheus counter |
| D8 | Concurrent file import | Reject second import while Processing |
| D9 | Deferred connector post-import | Extend Mongo RUNNING until post-import completes |
| D10 | Stale RUNNING | Heartbeat + idle-based sweeper |
| D12 | Collection crons | Included in freeze (D3 exception reverted) |
| D13 | Global exempt | Fetch Currency Rates only |
| D14 | Reject import API | HTTP 409, code IMPORT_IN_PROGRESS |
| D15 | Heartbeat interval | At least once per 60 seconds while RUNNING |
| D17 | Trend cron | Whole Customer Policy Trend handler exempt from freeze |
| D18 | Stale idle cap | TIMEOUT after 2 hours without heartbeat |

### Shared freeze module

- Add `getFrozenAccountIds()` (and optionally `isAccountFrozen(accountId)`) in the cron-jobs package or credit-insurance-domain, callable from worker handlers and import/sync paths.
- **Postgres inputs:** distinct `account_id` from `ImportJob` where `status = 'Processing'`; distinct `account_id` from `CreditAsOfBackfillJob` where `status IN ('running', 'paused')`.
- **Mongo input:** distinct `account_id` from connector sync executions where `status = 'RUNNING'`. Requires a store method to list running executions by account (not present today — add to sync history layer).
- Return a `Set<number>` or sorted array; callers load once per cron invocation.

### Cron handler integration

- At the start of each non-exempt handler, resolve frozen IDs.
- Apply account filter to queries (`account_id NOT IN …`), skip iterations in account loops, or early-continue per account in snapshot jobs that already iterate by account.
- Increment skip metric and emit one structured log line with `{ jobName, frozenAccountIds, frozenCount, skippedCount }` when any skips occur.
- **Exempt handlers:** Fetch Currency Rates (no freeze check); Customer Policy Trend Daily Snapshot (no freeze check on the handler entry — internal snapshot loops may still optionally skip frozen accounts in a follow-up if product revisits D17).

### Worker crons that must respect freeze (non-exhaustive)

Process Overdue Invoices, Compute Customer Overdue Metrics, Close Zero Outstanding Debt Invoices, Fix Closed Collection Data, Compute Gap In Base Currency, Credit Dashboard Daily Snapshot, Insurance Policy Trend Daily Snapshot, Sync Billing Connectors (do not start sync), Process Due Notifications, Process Notification Rules, Move Collection To Next Category, Process Automated Collection Periods, Activity Workflow Manager, Inforu SMS Status Check, Report Scheduler — each skips work targeting frozen accounts.

### File import lifecycle

- **`completeJob` reorder (Invoice/Payment):** run post-import orchestrator while job remains `Processing`; set `Completed` only after orchestrator returns (success or best-effort completion with recorded failures — job still completes, but freeze ends when orchestrator exits).
- **`createJob` / first `importLeaf` guard:** if any `ImportJob` with `status = Processing` exists for the account, throw 409 with `{ code: "IMPORT_IN_PROGRESS" }`.

### Billing connector sync lifecycle

- **Delayed terminal status:** when defer-post-ingest is used (default for backfill), keep Mongo execution `RUNNING` until inline tail or enqueued drain completes; only then call `completeExecution`.
- **Heartbeat field:** add `last_progress_at` (or reuse document `updated_at`) on connector sync execution documents; update on entity progress, tail steps, and post-import drain progress at least every 60 seconds.
- **Sweeper change:** replace wall-clock-from-`started_at` rule with idle-from-`last_progress_at` ≥ 2 hours → `TIMEOUT`.
- **Scheduled sync cron:** before `createRunningExecution`, skip connector if `accountId` is in frozen set (covers file import + as-of backfill + already RUNNING).

### Admin as-of backfill

- Reuse existing `CreditAsOfBackfillJob` statuses; include in `getFrozenAccountIds()` so all crons align with rewrite drain skip semantics, extended platform-wide.

### API contract

```
POST import createJob / importLeaf (first batch)
→ 409 Conflict
   { "code": "IMPORT_IN_PROGRESS", "error": "..." }
```

Optional follow-up: include existing `jobId` in body (not locked in grill-me; plain 409 chosen).

## Testing Decisions

### What makes a good test

- Assert **external behavior** at the highest stable seam: given an account is frozen, a cron handler does not mutate that account’s invoices/customers; given unfreeze, the same handler processes the account.
- Do not assert internal loop counters or private helper call order unless testing the helper itself in isolation.
- Prefer deterministic fixtures: create `ImportJob` Processing, invoke cron handler with test Prisma, assert no invoice status change / no customer insurance field update for that account while another control account is still processed.

### Primary test seam (recommended)

**`getFrozenAccountIds()` + one representative cron handler** (e.g. Process Overdue Invoices or Compute Customer Overdue Metrics):

- Unit/integration tests on the helper with mocked Postgres + Mongo inputs (Processing job, RUNNING execution, as-of backfill row).
- Handler test: seed Due invoice on frozen vs unfrozen accounts; run handler; assert only unfrozen account transitions.

This is the **single highest seam** — if the helper and one handler are correct, wiring the same pattern into other handlers is mechanical.

### Additional seams

- **Import API:** create Processing job → second `createJob` returns 409 `IMPORT_IN_PROGRESS`.
- **Import complete order:** Invoice job Complete path leaves Processing until orchestrator mock resolves, then Completed.
- **Sync history:** RUNNING not completed until post-import callback finishes; heartbeat updates `last_progress_at`; sweeper TIMEOUT only after 2h idle (unit test with injected clock).
- **Sync Billing Connectors:** frozen account not started when ImportJob Processing exists.
- **Exemptions:** Fetch Currency Rates runs with frozen account present; Customer Policy Trend drain processes retry queue row for frozen account (mock drain invocation).

### Prior art

- As-of rewrite drain `skippedForBackfill` pattern in customer policy trend cron handler.
- Billing connector sync history store tests and stale RUNNING sweeper tests.
- Import job complete post-ingest tests (`import-job-complete-post-ingest.test.ts`).
- AR post-ingest orchestrator tests at orchestration seam.

## Out of Scope

- Redesigning post-import orchestrator steps or order (covered by import-ar-post-ingest-refresh PRD).
- UI for “account frozen” or import progress beyond existing job status (except handling 409 later).
- Translation / i18n changes.
- Freezing **per customer** within an account (always account-level).
- Blocking read-only API access during import.
- Cross-process in-memory `getRunningSync` on API as freeze signal (Mongo RUNNING is source of truth for connector).
- ClickUp issues or `.scratch/` vertical slices (use `/to-issues` after PRD approval).
- Splitting Customer Policy Trend into separate drain vs snapshot crons (D17 chose whole-handler exempt; may revisit).

## Further Notes

### Discovery gate (blocking)

| Gate | If yes | If no |
|------|--------|-------|
| Mongo list RUNNING by account_id | Wire into freeze helper | Add sync history store query |
| Worker has MONGODB_URI | Connector RUNNING signal reliable | Document degraded freeze (ImportJob + as-of only) |

### D17 tradeoff

Exempting the entire Customer Policy Trend cron avoids deadlock for deferred post-import drain but allows CPT/trend snapshot writes during import for frozen accounts. Revisit by splitting drain (exempt) from snapshots (frozen) if snapshot races appear in QA.

### Relationship to transaction timeout fix

Raising `syncCustomerInsuranceFields` transaction timeout and moving zero-limit scan outside the transaction mitigates symptoms; this PRD addresses the root cause (cron/import concurrency) for production accounts under load.

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under `.scratch/import-cron-account-freeze/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.scratch/import-cron-account-freeze/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Frozen account resolver | `issues/01-frozen-account-resolver.md` | — | 19–23, 26 |
| 2 | Import lifecycle and API guard | `issues/02-import-lifecycle-and-api-guard.md` | 01 | 1, 15–18, 29 |
| 3 | Connector RUNNING heartbeat and completion | `issues/03-connector-running-heartbeat-and-completion.md` | 01 | 2–4, 24–26 |
| 4 | AR and insurance crons freeze | `issues/04-ar-insurance-crons-freeze.md` | 01, 02 | 5, 8–10, 19, 27–28 |
| 5 | Collection, sync, and remaining crons freeze | `issues/05-collection-sync-and-remaining-crons-freeze.md` | 04 | 6–7, 11–14, 30–32 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.

Slices 02 and 03 can run in parallel after 01 completes.
