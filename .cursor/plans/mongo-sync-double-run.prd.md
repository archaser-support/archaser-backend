---
name: mongo-sync-double-run
overview: Prevent overlapping Mongo sync history RUNNING rows per account (cron and manual), with deploy cleanup of existing twins; keep the 2h idle TIMEOUT sweeper for stuck runs.
source: grill-me session /start-work CU-869f7tzfj
clickup_task_url: https://app.clickup.com/t/869f7tzfj
isProject: false
---

# Mongo sync one RUNNING per account

## Problem Statement

Ops sees billing-connector sync history for an account (e.g. 10149 in production) where two **scheduled incremental** executions start at the **same second** — one stays `RUNNING`, another ends `FAILED`. The soft freeze that skips accounts already `RUNNING` is a snapshot at cron start and is not a hard mutex across worker replicas, so both starters can pass the check, both create Mongo history stubs (unique only on `execution_id`), and both run. A lingering `RUNNING` also freezes that account until the 2h idle sweeper marks `TIMEOUT`, which looks like a stuck sync.

Separately, wall-clock `every_12h` due-checks can produce ~11.5h gaps between successful starts when one tick is late to its UTC slot; that is expected schedule math, not the double-run bug.

## Solution

Enforce **at most one Mongo sync history document with status `RUNNING` per account**. The second start (cron or manual) detects the uniqueness conflict, **skips quietly** (log + skipped count, no new history row), and does not run ingest. Deploy cleans existing duplicate `RUNNING` rows (keep newest; older twins → `TIMEOUT`) then creates the unique index. Keep the existing **2-hour idle** stale sweeper → `TIMEOUT` so stuck runs clear and a later due sync can start. Other Mongo write failures on create-running still do not block sync (history must not block ingest), except uniqueness conflicts which must skip.

## User Stories

1. As an operations user, I want at most one `RUNNING` sync history row per account, so that two scheduled ticks cannot pull the same connector at once.
2. As an operations user, I want a second concurrent scheduled start to skip without creating a second history row, so that the sync log stays readable.
3. As an operations user, I want skip events logged and counted, so that I can see contention without fake FAILED rows.
4. As an operations user, I want the same one-RUNNING rule when I start a manual sync, so that manual and cron cannot overlap.
5. As an operations user, I want a stuck idle `RUNNING` to become `TIMEOUT` after two hours without progress, so that the account is not frozen forever.
6. As an operations user, I want a new due sync to start after TIMEOUT or SUCCESS/FAILED, so that recovery does not need a code deploy.
7. As a developer, I want create-running uniqueness conflicts to abort that connector attempt, so that ingest never runs without owning the RUNNING stub when the conflict is “already running”.
8. As a developer, I want other create-running failures (Mongo outage) to still allow sync, so that history outages do not stop billing pulls.
9. As a deployer, I want a one-time cleanup of duplicate RUNNING rows before the unique index, so that migrate/index create succeeds in production.
10. As a deployer, I want older twin RUNNING rows marked TIMEOUT during cleanup, so that history shows they were superseded rather than left RUNNING forever.
11. As an operations user, I want account 10149 (and all accounts) protected the same way, so that the fix is not a one-off special case.
12. As a developer, I want the memory sync-history store used in tests to enforce the same one-RUNNING-per-account rule, so that unit tests can cover the skip path without Mongo.
13. As an operations user, I want freeze-on-RUNNING cron skip to remain as a fast path, so that most ticks avoid attempting create-running when already busy.
14. As an operations user, I want successful twice-daily incremental runs on an every_12h schedule to continue, so that fixing overlap does not change intended cadence.
15. As a support engineer, I want clear log wording when a sync is skipped because another is RUNNING, so that I can explain the log to customers without guessing.

## Implementation Decisions

- **Mutex:** Partial unique index (or equivalent store invariant) on sync history: at most one document with `status: RUNNING` per `account_id`. Unique `execution_id` remains.
- **Conflict behavior:** On duplicate-key / already-running from create-running: do **not** start ingest; increment skipped; structured log; **no** new history row.
- **Other create-running errors:** Continue today’s “history must not block sync” for non-uniqueness failures (cron and accept paths).
- **Call sites:** Scheduled due-sync loop and manual accept (API and connectors) share the same create-running + conflict handling.
- **Stale recovery:** Keep `STALE_RUNNING_HOURS = 2` idle sweeper → `TIMEOUT` with existing message; no threshold change in this work.
- **Deploy cleanup:** Before ensuring the unique index, for each account with multiple RUNNING docs keep the newest (by `started_at` / `_id`), set older twins to `TIMEOUT` with a clear cleanup reason, then create the index.
- **Scope:** All accounts; not 10149-specific.
- **i18n:** No new user-facing copy expected. If manual accept returns a user-visible “already running” message, ship EN + HE together.
- **Not changing:** Connector cron expression / due-check math (`hasCronFiredBetween`), overlap minutes, BullMQ job-level serialization of the whole Sync Billing Connectors tick (optional follow-up).

## Testing Decisions

- Prefer behavior at the **sync history store / create-running** seam and the **scheduled due-sync** seam (second concurrent create-running skips; first continues). Prefer existing package unit-test patterns over new e2e unless asked.
- Good tests assert external outcomes: one RUNNING max; second start skipped without a second RUNNING; non-uniqueness create failure still allows sync when that path is under test; sweeper still TIMEOUT after idle threshold.
- Memory store must mirror the uniqueness invariant so tests do not require live Mongo.
- Do not add or expand automated tests unless the user explicitly asks during implementation.

## Out of Scope

- Shortening the stale sweeper or aligning it with the 15m metrics gauge / 900s cron timeout.
- API cancel for cron-owned runs (orphan Mongo cancel from Nest).
- Production Grafana alerts for stale RUNNING (staging already has richer rules).
- Root-cause fix for twin `fetch failed` / Priority fetch errors.
- Serializing the entire Sync Billing Connectors BullMQ job across replicas (beyond per-account RUNNING uniqueness).
- Changing every_12h wall-clock semantics or UI timezone display.
- Redis/Postgres distributed locks as an alternate mutex.

## Further Notes

- Incident evidence: account 10149, two `INCREMENTAL` / `scheduled` rows at `26/09/2026, 15:02:27` (one RUNNING with payment progress, one FAILED `fetch failed` ~1177s). Soft freeze alone did not prevent that.
- ~11.5h gaps between SUCCESS starts on an every_12h connector are wall-clock slot pickup via the */15 worker, not double-run.
- ClickUp: https://app.clickup.com/t/869f7tzfj
- Branch (local): `fix/mongo-sync-double-run-CU-869f7tzfj`

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/mongo-sync-double-run/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/mongo-sync-double-run/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Unique RUNNING + conflict skip (cron & manual) | `issues/01-unique-running-mutex.md` | — | 1–5, 7–8, 11–15 |
| 2 | Deploy cleanup of twin RUNNING rows + index ensure | `issues/02-deploy-cleanup-unique-index.md` | 01 | 6, 9–10 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
