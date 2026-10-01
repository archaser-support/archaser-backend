---
name: billing-new-customer-history
overview: When incremental billing sync creates new customers, enqueue durable per-customer history loads from backfill_start_date, drain them before the next incremental, without flipping the connector out of INCREMENTAL or corrupting account sync state.
source: grill-me + start-work session
clickup_task_url: https://app.clickup.com/t/869fa7tf0
isProject: false
---

# Billing sync — new customer history backfill

## Problem Statement

During daily incremental sync from the billing integration, the ERP (Enterprise Resource Planning) can return customers that do not yet exist in ARchaser. Those customers are created on the Customer entity pull, but their historical invoices, payments, and related entities are not loaded from the connector’s `backfill_start_date`. Incremental watermarks only pull recent changes, so new customers stay incomplete until someone manually runs Start backfill for that customer.

Operators need new customers to get a full history load automatically, without stopping incremental sync for the whole account and without risking account-wide backfill resume behavior.

## Solution

Keep the connector on **INCREMENTAL**. When an incremental sync **creates** customers, enqueue them on a durable **pending-history** queue. Before the next incremental is allowed, drain that queue with **customer-scoped** history loads from `backfill_start_date`. Sync now may return after incremental + enqueue; the server/cron continues draining until the queue is empty (or only needs-attention rows remain). Customer-history progress is **isolated** from account-level `ConnectorSyncState` cursors and watermarks. After five failed attempts, a customer moves to **needs attention** and no longer blocks incremental.

## User Stories

1. As an AR (Accounts Receivable) operator, I want new ERP customers discovered on incremental sync to receive full history automatically, so that their open items appear without a manual Start backfill.
2. As an AR operator, I want existing customers’ incremental sync to keep running on schedule, so that one new customer does not pause the whole account’s daily deltas.
3. As an AR operator, I want history for a new customer to start from the connector’s backfill start date, so that coverage matches the original onboard policy.
4. As an AR operator, I want only brand-new inserts to trigger history, so that routine customer updates do not re-pull history.
5. As an AR operator, I want this behavior only after the account has already reached INCREMENTAL, so that first-time account backfill is not duplicated.
6. As an AR operator, I want Sync now and the scheduled job to follow the same rules, so that manual sync does not leave new customers without history.
7. As an AR operator, I want Sync now to return promptly after incremental + enqueue, so that the browser is not held open for hours of history.
8. As an AR operator, I want the system to finish pending history before the next incremental starts, so that history is not raced by new deltas.
9. As an AR operator, I want multiple new customers in one run to all get history, so that a bulk ERP customer load is covered.
10. As an AR operator, I want one failed customer history not to block others in the queue, so that partial ERP failures do not strand everyone.
11. As an AR operator, I want a customer that fails history five times to stop blocking incremental, so that daily sync cannot get stuck forever.
12. As an AR operator, I want failed-after-N customers marked as needing attention in status/API, so that support can find and fix them.
13. As an engineer, I want pending history to survive process restarts, so that a crash after create does not permanently skip history.
14. As an engineer, I want mid-customer history resume to stay scoped to that customer, so that Resume never widens to the whole account.
15. As an engineer, I want customer-history runs not to reset or rewrite account backfill cursors or `last_max_updated_at`, so that INCREMENTAL health is preserved.
16. As an engineer, I want pending count and customer ids on connector sync status/API, so that we can operate without a new UI screen.
17. As an engineer, I want structured logs for enqueue, drain start/finish, per-customer success/failure, and needs-attention transitions, so that production incidents are diagnosable.
18. As a support engineer, I want to re-queue or manually Start backfill for a needs-attention customer later, so that recovery is possible after the ERP issue is fixed.
19. As an AR operator, I want customers that already exist and are only updated to be ignored by this queue, so that noise and ERP load stay low.
20. As an AR operator, I want historical data already pulled in the same incremental (recent pages) to remain correct after the history load, so that overlaps upsert cleanly rather than duplicate.
21. As an engineer, I want orchestration tests at the sync entry seam, so that drain-before-incremental and failure policy are locked without over-testing internals.
22. As a product owner, I want no dedicated pending-history UI in MVP (Minimum Viable Product), so that delivery focuses on correctness first.

## Implementation Decisions

- **Mode:** Do not flip `sync_mode` to BACKFILL for this flow. Account stays INCREMENTAL. Reuse the existing customer-scoped Start backfill idea (single Archaser `customer_id` filter on ERP pulls) as the history mechanism.
- **Enqueue trigger:** During Customer entity import on an INCREMENTAL run, when a customer row is **created** (not updated), insert a durable pending-history record for `(connector/account, customer_id)` if one is not already pending or in needs-attention (idempotent enqueue).
- **Skip when:** Connector `sync_mode` is BACKFILL (account-wide onboard). Do not enqueue.
- **Queue states:** at least `pending`, `in_progress`, `needs_attention`, and terminal success removal (or `completed` then delete). Track `attempt_count`, `last_error`, timestamps, and enough data to resume scoped history for that customer.
- **Orchestration order:** On scheduled due sync and on manual sync paths that would run incremental: if any non–needs-attention pending/in-progress rows exist, drain customer history first; only then run incremental. While draining after an incremental that just enqueued, Sync now may return after incremental + enqueue; background/cron continues draining until the blocking queue is empty.
- **Drain policy:** Process customers sequentially (one RUNNING sync per account). On hard failure, leave the customer queued, increment attempts, continue with the next customer. After **5** failed attempts, set `needs_attention` and do not let that row block incremental.
- **Progress isolation (required):** Customer-history runs must not reset or leave account-level `ConnectorSyncState` in a partial-backfill shape, and must not advance account incremental watermarks (`last_max_updated_at`) from scoped pages. Persist customer-history cursors/progress on the queue row (or equivalent isolated store). Resume must preserve customer scope (D6).
- **Clear-before-import:** Auto history for new customers does not clear existing data for that customer by default (new customers are empty).
- **Date range:** History uses the connector’s `backfill_start_date` (null means full history per existing semantics).
- **Observability MVP:** Structured logs + connector sync status/API fields for pending count, pending customer ids, and needs-attention count/ids. No new dedicated UI screen. Any new user-facing strings (if status labels surface in UI later in this work) ship EN+HE together; MVP assumes API/log-only unless an existing status surface already shows free text.
- **Modules:** billing-connector sync orchestration (due sync + run sync), customer import create path, new pending-history persistence, billing-connector API status mapping, existing customer-scoped OData (Open Data Protocol) filter reuse.
- **Primary repo:** backend only for MVP.

## Testing Decisions

- Prefer **one orchestration seam**: scheduled due-sync and manual Sync now entry points. Assert external behavior only (queue side effects, ordering drain-before-incremental, needs-attention after five failures, account cursors/watermarks unchanged after customer history).
- Do not require new automated tests unless the user explicitly asks for tests in an implementation session.
- Good tests observe outcomes (pending rows, whether incremental ran, status fields), not internal function call graphs.
- Prior art: existing billing-connector sync/API tests around `runSync`, cancel, and customer-scoped Start backfill.

## Out of Scope

- Flipping the whole connector to BACKFILL / canceling incremental for everyone
- Dedicated pending-history management UI
- Enqueue during account-wide BACKFILL
- Treating customer **updates** as history candidates
- Multi-customer parallel history (blocked by one RUNNING sync per account)
- Changing `backfill_start_date` semantics
- Frontend-only work (unless an existing status panel already displays the new API fields and must not break)
- Automatic recovery from needs-attention without ops action (beyond status visibility)

## Further Notes

### Decision log (grill)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Pause vs customer-only | Customer-only history; keep INCREMENTAL |
| D2 | When to run | After incremental succeeds (and drain-before next incremental) |
| D3 | Who | Newly created in this sync run |
| D4 | Crash safety | Durable pending-history queue |
| D5 | Ordering | Drain pending before next incremental |
| D6 | Mid-customer resume | Preserve customer scope |
| D7 | Hard fail | Keep queued; continue others |
| D8 | Account BACKFILL | Skip enqueue |
| D9 | Shared sync state | Isolate customer-history progress |
| D10 | Manual Sync now | Same rules as scheduled |
| D11 | Drain completeness | Blocking queue must be empty before incremental |
| D12 | Long drain / HTTP | Sync now returns after enqueue; server/cron keeps draining |
| D13 | Observability MVP | Logs + API status; no dedicated UI |
| D14 | Repeated failures | Needs attention after N; stop blocking |
| D15 | N | 5 |
| D18 | Test seam | One orchestration seam |

### Engineering gates

| Gate | Notes |
|------|-------|
| Isolated progress store for customer history | Blocks safe implementation of D9 |
| Scoped resume carrying customer id | Blocks safe multi-tick drain (D6) |

### Branch

- `feat/billing-new-customer-history-CU-869fa7tf0` (backend primary)

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/billing-new-customer-history/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/billing-new-customer-history/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Isolate customer-scoped history progress | `issues/01-isolate-customer-history-progress.md` | — | 14, 15 |
| 2 | Pending-history queue + enqueue on create | `issues/02-pending-queue-and-enqueue.md` | 01 | 1, 3, 4, 5, 13, 16, 17, 19 |
| 3 | Drain-before-incremental orchestration + failure policy | `issues/03-drain-orchestration-and-failures.md` | 01, 02 | 2, 6–12, 18, 20, 21 |

**Status:** `ready-for-agent` on all slices.
