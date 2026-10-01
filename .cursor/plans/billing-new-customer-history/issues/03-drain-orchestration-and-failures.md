# 03 — Drain-before-incremental orchestration + failure policy

**Status:** done
**Priority:** normal
**Blocked by:** [01-isolate-customer-history-progress](01-isolate-customer-history-progress.md), [02-pending-queue-and-enqueue](02-pending-queue-and-enqueue.md)
**User stories:** 2, 6, 7, 8, 9, 10, 11, 12, 18, 20, 21
**PRD:** `.cursor/plans/billing-new-customer-history.prd.md`

## What to build

Wire orchestration so pending (non–needs-attention) history is drained **before** incremental is allowed. After an incremental that enqueues new customers, Sync now may return once incremental + enqueue finish; server/cron continues draining until the blocking queue is empty. Process customers sequentially using isolated customer-scoped history from slice 01. On hard failure: keep queued, continue others, increment attempts; after **5** failures set needs_attention and stop letting that row block incremental. Same rules for scheduled and manual incremental paths.

## Acceptance criteria

- [x] If blocking pending/in_progress rows exist, history drain runs before incremental
- [x] After successful customer history, that queue row is cleared
- [x] Multiple pending customers drain sequentially
- [x] One failure does not stop the rest of the drain
- [x] After 5 failures → needs_attention; incremental can proceed if no other blocking rows remain
- [x] Sync now returns after incremental + enqueue without waiting for full multi-hour drain; drain continues in-process/cron
- [x] Scheduled and manual incremental share the same rules
- [x] Structured logs for drain start/finish, per-customer success/failure, needs-attention transition
- [x] Status/API reflects needs-attention count/ids

## How to test

1. Enqueue two new customers via incremental (or seed two pending rows on staging).
2. Trigger due sync / Sync now: confirm history for both runs (or continues across ticks) before a new incremental is allowed.
3. Force one customer history to fail repeatedly: after 5 attempts it is needs_attention; the other customer still drains; incremental is allowed again.
4. Sync now with new customers: HTTP returns after incremental; pending remains until drain completes on server/cron.
5. Confirm no account-wide mode flip and no corrupted account watermarks (slice 01 still holds under orchestration).
