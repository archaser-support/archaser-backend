---
name: snapshot-generate-single-writer
overview: Stop two Portfolio Health Generate (as-of snapshot) writers from updating the same account at once. Keep the first healthy run; skip or stop the second immediately. Reclaim only when the first run’s heartbeat is stale.
isProject: false
---

# Snapshot Generate — one writer per account

## Problem

Portfolio Health Generate is supposed to be **one job per account**. Status `running` already blocks a second start in memory, but writers still overlap:

1. **Check-then-upsert race** — `startCreditAsOfBackfillJob` reads status, then `INSERT … ON CONFLICT DO UPDATE` without requiring “not running”.
2. **Enqueue kills the live queue job** — `requeueCreditAsOfBackfillBullJob` force-removes an **active** BullMQ job (clears Redis lock) and adds a new one. The old Node process can keep walking days.
3. **Retry while `running`** re-enqueues (same force-replace).
4. **Worker boot reclaim** requeues every `running` account, even if a worker is still writing.
5. **In-process `runnersInFlight`** does not work across API vs worker or two worker processes.
6. **Parent-link history** uses a different `job_kind` and can rewrite the same snapshot tables while Generate is running.

`AccountBackgroundJob.run_token` already exists. VAT refresh and parent-link history use it; Generate does not.

## Decision log (grill)

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Second writer, same account | Keep the first run. Second must not write — skip, or stop immediately if it already started. | Do not cancel a healthy first run; do not queue a follow-up range. |
| D2 | Worker restart | Reclaim only if the first run looks dead (stale heartbeat). If still writing, do not start another writer. | Fixes boot reclaim starting a duplicate. |
| D3 | When “dead” | Heartbeat often while writing (even mid-day). Dead if heartbeat older than **~2 minutes**. Then a new writer may continue from the last saved day. | One snapshot day can exceed a few minutes; checkpoint-only stale checks are too slow or too eager. |
| D4 | New start while first is healthy | Refuse. Keep first run’s dates. Return already-running conflict (today’s error). | Billing / VAT catch-up already log conflict and leave the caller successful. |
| D5 | Stale + new Generate | If heartbeat is stale, a **new Generate may take over with the new date range** (reset checkpoint). Automatic reclaim with no new dates **resumes from last saved day**. | Crash recovery without blocking a deliberate new range. |
| D6 | Old process after take-over | Stop **immediately**. Do not finish the in-progress day. New holder rewrites from last saved day (in-progress day may be written again). | Two writers on the same day is the bug. Unlike Stop (finish current day). |
| D7 | Other snapshot jobs | Also refuse Generate if **parent-link history** is writing snapshots; skip/refuse the other writer too. | Same tables (`CustomerPolicyTrend`, dashboard daily snapshots). |
| D8 | VAT vs Generate | VAT refresh does **not** block Generate while only updating customer totals. Lock applies when VAT **starts Generate** at the end (D4). Parent-link history blocks Generate for the whole history run. | VAT is not a snapshot writer until it enqueues Generate. |
| D9 | Parent-link while Generate | Refuse parent-link history start. Keep Generate. Already-running style error. | Symmetric with D7; no auto-queue. |
| D10 | Retry while `running` | If Generate is **healthy and running**, Retry is a **no-op** (do not replace the queue job). Stale recovery is reclaim (D2) or new Generate take-over (D5), not Retry-while-running. | Today’s Retry-while-running is a duplicate-writer path. |

## Reuse (do not invent a second lock)

| Piece | Owner | Action |
|-------|--------|--------|
| `run_token` on `AccountBackgroundJob` | Prisma + VAT / parent-history jobs | **Extend Generate** the same way VAT does: claim token at start; every checkpoint/status write `AND run_token = $mine`; exit immediately if token/status mismatch (D6). |
| `runnersInFlight` | `creditAsOfBackfillJob.ts` | Keep as a fast same-process skip; **not** the real lock. |
| Unique Bull job id `credit-asof-backfill-${accountId}` | `creditAsOfBackfillBullJobId` | Keep. Change **requeue**: do not force-remove an active job while heartbeat is fresh. |
| Overnight drain skip while Generate `running`/`paused` | `asOfRewriteQueue` | Unchanged. |
| Conflict error | `CreditAsOfBackfillConflictError` / `CreditPoolParentHistoryConflictError` | Reuse for D4 / D9; add cross-kind checks on start. |

Heartbeat: reuse `updated_at` (already touched at run start and checkpoint). Add a **timer/touch while a day is in progress** (D3), not only after the day upserts.

Atomic start: `UPDATE … WHERE status <> 'running' OR updated_at < stale` (and parent-history not running) **or** insert with `run_token`, instead of read-then-upsert.

## Implementation sketch (after approval)

1. **Lease** — On Generate start (non-stale refuse): new `run_token`. Runner loads token once; day loop and all status writes require that token. Lost lease → return without writing more days (D6). Do not mark the row `failed` (another holder owns it).
2. **Heartbeat** — While `running`, touch `updated_at` at least every ~30s (including mid-day). Stale threshold **2 minutes** (env-capped).
3. **Start** — If same-kind `running` and heartbeat fresh → `CreditAsOfBackfillConflictError` (D4). If parent-history `running`/`paused` → same class of conflict (D7). If Generate stale → take over with new range + new token (D5).
4. **Parent-history start** — If Generate `running` with fresh heartbeat → `CreditPoolParentHistoryConflictError` (D9). (Stale Generate reclaim is Generate’s problem, not history’s.)
5. **Retry** — If `running` and healthy → return current status, no enqueue (D10). Paused/failed Retry unchanged.
6. **Worker reclaim** — Only accounts with `running` **and** `updated_at` older than 2 minutes. Enqueue without starting a second live writer. Resume from checkpoint (D2). Do not reset `from_date`/`to_date`.
7. **Bull requeue** — If job is `active` and DB heartbeat is fresh, **leave it**. Force-remove only for stale reclaim or D5 take-over (new token).
8. **Inline fallback** (`queued: false` → `runCreditAsOfBackfillJob` on API) — still must take the same `run_token` so a worker cannot also run.

## Codebase scan

**Required**

- `packages/credit-insurance-domain/src/credit-insurance/domain/creditAsOfBackfillJob.ts` — start/retry/run/reclaim list
- `api/src/queue/backfill-bull-job.util.ts` + `worker/src/backfill-bull-job.util.ts` — stop blindly force-removing active jobs
- `api/src/queue/cron-queue.service.ts` — enqueue policy
- `worker/src/main.ts` — `reclaimRunningCreditAsOfBackfillJobs` stale filter
- `packages/credit-insurance-domain/src/credit-insurance/domain/creditPoolParentHistoryJob.ts` (+ progress start) — D9 / D7
- Existing conflict handling: `postSyncCtpCatchUp.ts`, `accountVatBasisRefreshJob.ts` enqueue Generate (already catch conflict)

**No change needed**

- Snapshot **math** / as-of writers — overlap is a lock problem, not a formula change
- VAT job body (D8) — only its existing Generate enqueue + conflict log
- Overnight drain skip rule
- Schema — `run_token` and `updated_at` already exist (no migration unless we add a dedicated `heartbeat_at`; prefer `updated_at` unless checkpoint throttling fights heartbeat)

**Out of scope unless requested**

- Queue a second date range after the first finishes (rejected in D1/D4)
- Shared single-row lock across VAT+Generate+history (rejected; VAT not a snapshot writer until Generate)
- Changing Stop-button semantics (still finish current day for a user pause)
- Frontend copy beyond existing already-running errors (add EN+HE only if we introduce a new message for parent-history vs Generate)

## How to test

1. Start Generate for an account; start Generate again (second click / API) → conflict, first progress continues, one writer in logs.
2. Click Retry while the bar is moving → no new queue replace; same token still writing.
3. Restart the worker during a healthy run → no second “starting for account” while heartbeat is fresh.
4. Pause heartbeat (or wait >2 minutes after killing the process without updating status) → reclaim **or** new Generate with a new range takes over; old process if still alive stops without more day writes.
5. Start Generate, then save a parent-customer change that would start history → history refused; Generate continues. Reverse: history running → Generate refused.

## Related

- `.cursor/plans/portfolio-health-generate-snapshots.prd.md` (D11 one job; this PRD hardens it)
- `.cursor/plans/overnight-asof-rewrite-drain-reliability.prd.md` (drain skip vs admin Generate)
- VAT `run_token` supersede pattern in `accountVatBasisRefreshJob.ts`
