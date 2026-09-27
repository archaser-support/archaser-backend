# 01 — Unique RUNNING + conflict skip (cron & manual)

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 7, 8, 11, 12, 13, 14, 15
**PRD:** `.cursor/plans/mongo-sync-double-run.prd.md`

## What to build

Enforce at most one sync-history document with status `RUNNING` per account in the Mongo (and memory) sync-history store. When create-running hits that conflict, scheduled due-sync and manual accept skip quietly: no ingest, no new history row, structured log + skipped count. Other create-running failures continue to allow sync (history must not block ingest). Keep the existing 2h idle sweeper → `TIMEOUT` unchanged. Soft freeze-on-RUNNING remains as a best-effort fast path.

## Acceptance criteria

- [ ] Store invariant: cannot have two `RUNNING` rows for the same `account_id`
- [ ] Uniqueness conflict → skip ingest, log, count skipped; no second history row
- [ ] Non-uniqueness create-running failure still allows sync on cron and accept paths
- [ ] Manual accept uses the same conflict skip behavior as scheduled sync
- [ ] Stale idle sweeper still marks `TIMEOUT` after 2h without progress
- [ ] Memory store used in tests mirrors the uniqueness invariant

## How to test

1. With two concurrent starts for the same account (or a unit harness that calls create-running twice), confirm only one `RUNNING` row exists and the second start skips without ingest.
2. Trigger Sync Billing Connectors while an account already has `RUNNING`; confirm skip in logs/summary and no twin history row.
3. From the UI/API, attempt manual sync while a scheduled run is `RUNNING`; expect already-running skip (no second RUNNING).
4. Leave a RUNNING idle past 2h (or invoke sweeper with a short test threshold if available in harness); expect `TIMEOUT` and a later due sync can create a new `RUNNING`.
