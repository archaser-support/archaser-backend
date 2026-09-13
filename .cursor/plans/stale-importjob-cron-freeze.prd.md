---
name: stale-importjob-cron-freeze
overview: Clear stuck ImportJob Processing rows so cron freeze cannot lock an account forever; heartbeat live post-import so long Invoice/Payment jobs are not false-failed.
source: grill-me + start-work (account 10149)
clickup_task_url: https://app.clickup.com/t/869f04t0a
isProject: false
---

# Stale ImportJob Processing cron freeze recovery

## Problem Statement

Worker crons skip an account whenever any `ImportJob` for that account has `status = Processing`. When imports crash or leave jobs stuck, those rows never leave `Processing`, so the account stays “frozen” indefinitely: overdue, collection, and related jobs keep skipping it. Account 10149 is an example with many stuck Processing jobs.

Operators and clerks still need to log in and use the app. Cron freeze is not login freeze — login uses a separate user flag — but a stuck Processing job also blocks starting a new file import (HTTP 409). There is no ImportJob stale sweeper today (Mongo connector sync already has an idle TIMEOUT sweeper).

## Solution

Add a shared stale ImportJob sweeper: any `Processing` job whose `modified_at` has been idle longer than **2 hours** is marked **Failed** with a clear stale/no-progress error and a `completed_at` timestamp. Run that sweeper **before** building the frozen-account set on cron freeze resolve, and again **before** the import-in-progress check when starting a file import.

While Invoice/Payment **post-import** work runs (job stays Processing), bump `modified_at` at least every **60 seconds** so a live long orchestrator is not mistaken for a dead job.

For account **10149**, ops immediately marks all current stuck Processing jobs Failed with the same stale message so crons resume before/while the code ships.

## User Stories

1. As an operations engineer, I want stuck Processing import jobs to auto-fail after 2 hours with no progress, so that one dead import cannot freeze cron work forever.
2. As an operations engineer, I want the sweeper to run when worker crons resolve the frozen set, so that the next cron tick unfreezes the account without a manual SQL step every time.
3. As an accounts receivable clerk, I want starting a new file import to clear stale Processing jobs first, so that I am not blocked by 409 after an old crashed import.
4. As an accounts receivable clerk running a long Invoice or Payment import, I want post-import to heartbeat progress on the job, so that a multi-hour refresh is not marked Failed at the 2-hour idle line.
5. As an operations engineer, I want stale jobs marked Failed (not Completed) with a clear error message, so that history shows the import did not finish cleanly.
6. As a platform engineer, I want one shared sweep helper used by freeze resolve and import start, so that idle rules cannot drift between call sites.
7. As a collections manager, I want crons to process account 10149 again after its stuck jobs are failed, so that overdue and collection automation resume.
8. As a support engineer, I want login to keep working during cron freeze, so that users are not locked out of the product when imports are busy or stuck.
9. As an operations engineer, I want a one-shot ops clear for all Processing jobs on account 10149, so that production is unblocked before the sweeper ships.
10. As a QA engineer, I want to verify a job with recent `modified_at` is not swept, so that live imports stay Processing.
11. As a QA engineer, I want to verify a job idle over 2 hours becomes Failed and drops out of the frozen set, so that the primary regression is observable.
12. As a QA engineer, I want to verify import start sweeps then still returns 409 when a truly live Processing job exists, so that concurrent import protection remains.
13. As a developer, I want post-import heartbeats at least every 60 seconds, matching connector sync progress expectations, so that idle thresholds stay aligned across ingest paths.
14. As a product owner, I want no login/auth redesign in this work, so that scope stays on ImportJob and cron freeze only.
15. As an operations engineer, I want structured logging when jobs are swept, so that I can tell auto-fail from user-driven failures.
16. As a platform engineer, I want Pending jobs left alone by this sweeper, so that we only clear Processing rows that drive freeze and 409.
17. As a billing connector operator, I want connector-created ImportJob rows on the same table to follow the same idle rule, so that stuck connector batch jobs cannot freeze an account either.
18. As a developer, I want the freeze resolver to see a clean Processing set after sweep, so that skip metrics reflect true in-flight work.
19. As a support engineer, I want the stale error message to mention idle/no progress, so that tickets are easy to triage.
20. As a QA engineer, I want to confirm Failed jobs set `completed_at`, so that reporting windows treat them as finished.
21. As an operations engineer, I accept that imported rows already written stay in the database when a job is stale-failed, so that we do not invent a rollback in this change.
22. As a developer, I want this work additive to the existing import/cron freeze PRD, so that we extend recovery without redesigning freeze signals.
23. As a product owner, I want no new settings UI for unlock, so that recovery is automatic via sweeper and ops SQL for the incident.
24. As a QA engineer, I want How to test steps that do not require changing login behavior, so that auth regressions stay out of scope.

## Implementation Decisions

### Decision log (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| — | Login vs cron freeze | Cron freeze does **not** block login |
| D1 | Unblock strategy | Ops clear now + add stale ImportJob sweeper |
| D2 | Terminal status | **Failed** + clear stale error message |
| D3 | Idle rule | **2 hours** on `modified_at` + heartbeat during post-import |
| D4 | Sweeper home | Inside cron freeze resolve (before frozen-set query) |
| D5 | Import start | Sweep stale, then enforce 409 |
| D6 | Account 10149 | Mark **all** current Processing jobs Failed with the same message |
| — | Heartbeat interval | At least every **60 seconds** on `modified_at` during post-import |

### Shared sweeper

- Add a shared helper that finds `ImportJob` rows with `status = Processing` and `modified_at` older than 2 hours (optional account filter for import-start path).
- Update those rows to `Failed`, set `completed_at`, set a stable `error_message` (stale / no progress for N hours).
- Log how many jobs were swept (account ids / counts flattened for ops).
- Call from cron freeze resolve **before** querying Processing for the frozen set.
- Call from import start **before** asserting no import in progress (account-scoped).

### Post-import heartbeat

- While Invoice/Payment post-import orchestrator runs and the job remains Processing, bump `modified_at` at least every 60 seconds (reuse progress callbacks if present).
- Do not change the rule that Complete happens only after orchestrator returns.

### Ops incident (10149)

- One-shot update: all Processing jobs for account 10149 → Failed with the same stale message and `completed_at`.
- Document the statement in the plan / slice How to test; run by ops against the affected environment.

### i18n

- No new user-facing locale strings required for MVP (API/ops/error_message on job row only). If a UI later surfaces the message, ship EN+HE together.

## Testing Decisions

### What makes a good test

- Assert external behavior: after sweep, account is not frozen; live jobs with fresh `modified_at` stay Processing; import start still 409s when a non-stale Processing job exists.
- Do not assert private helper call order beyond the shared helper’s own unit seam.

### Primary seam (recommended)

Shared stale ImportJob sweeper + frozen-account resolve (and/or import assert):

- Given Processing + old `modified_at` → Failed and account not frozen.
- Given Processing + recent `modified_at` → unchanged and still frozen / still 409.
- Import start: stale cleared then live conflict still 409.

### Prior art

- Cron freeze resolver tests (`frozen-account-resolver` / handler freeze tests).
- Billing connector `sweepStaleRunning` idle TIMEOUT tests.
- Import 409 `IMPORT_IN_PROGRESS` tests.

Automated tests are **not** required to implement slices unless the user explicitly asks for tests.

## Out of Scope

- Changing login / `User.freeze` behavior.
- Admin UI button to unlock an account.
- Rolling back or deleting rows already imported by a stale job.
- Sweeping `Pending` jobs.
- Changing the 2-hour idle rule for Mongo connector `RUNNING` (already separate).
- Redesigning freeze signals beyond ImportJob recovery.
- Frontend translation changes for this MVP.

## Further Notes

### Relationship to import-cron-account-freeze

The freeze feature correctly skips crons during live import. This PRD adds **recovery** when Processing is a lie. Prefer extending that design rather than forking a second freeze concept.

### Discovery / ops gate

| Gate | If yes | If no |
|------|--------|-------|
| Confirm no live import worker still writing for 10149 | Safe to mark all 25 Failed now | Inspect `modified_at` / process list first, then fail |

### Issues (vertical slices)

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Stale Processing sweeper + freeze/import call sites | `issues/01-stale-processing-sweeper.md` | — | 1–3, 5–7, 9–12, 15–20 |
| 2 | Post-import modified_at heartbeat | `issues/02-post-import-heartbeat.md` | 01 | 4, 10, 13 |

**Overview:** `.cursor/plans/stale-importjob-cron-freeze/OVERVIEW.md`
