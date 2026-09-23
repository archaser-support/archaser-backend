# 03 — Post-sync Portfolio Health Generate start

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 10, 11, 12, 13, 14, 15, 16, 17, 19
**PRD:** `.cursor/plans/billing-integration-ext-ctp.prd.md`

## What to build

After an accepted in-process billing sync finalizes as `SUCCESS` for `incremental` or `backfill` (not preview), start Portfolio Health Generate asynchronously for the account’s pending as-of rewrite window (min imported invoice/payment date → today — covers full backfill history). Reuse `startCreditAsOfBackfillJob` (same job as the Portfolio Health page). Do not run tip-only CTP fill inline. If Generate fails to start (or is already running), leave billing sync status as SUCCESS; log the error/conflict.

## Acceptance criteria

- [x] SUCCESS incremental sync starts Generate when a pending rewrite window exists
- [x] SUCCESS backfill sync starts Generate for that same pending window (all import-touched days)
- [x] Preview / FAILED / PARTIAL do not start Generate
- [x] Generate runs async (`runInline: false`) so sync can finish SUCCESS quickly
- [x] No pending rewrite window → skip (log); do not invent a tip-only CTP fill
- [x] Generate start failure / already-running conflict does not change sync run status from SUCCESS
- [x] Failure/conflict is logged
- [x] Does not invoke dashboard writers inline inside the sync

## How to test

1. On a credit account, run a successful backfill that imports historical invoices (creates a pending rewrite window).
2. Confirm Sync History still shows SUCCESS quickly and logs show Portfolio Generate queued for the pending from–to range.
3. Confirm Portfolio Health Generate job is running/complete for that range (CTP + dashboard days).
4. Force Generate already running and confirm sync remains SUCCESS with a soft log.
5. Run a preview sync and confirm Generate is not started.
6. Spot-check a successful incremental path the same way when rewrite was enqueued.
