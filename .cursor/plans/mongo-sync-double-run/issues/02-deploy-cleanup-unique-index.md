# 02 — Deploy cleanup of twin RUNNING rows + index ensure

**Status:** done
**Priority:** high
**Blocked by:** [01-unique-running-mutex](01-unique-running-mutex.md)
**User stories:** 6, 9, 10
**PRD:** `.cursor/plans/mongo-sync-double-run.prd.md`

## What to build

Ship a one-time / idempotent deploy-safe cleanup for sync history: for each account with multiple `RUNNING` documents, keep the newest, mark older twins `TIMEOUT` with a clear cleanup reason, then ensure the partial unique index (one RUNNING per account) exists. Safe to re-run after cleanup (no-op when no twins). After cleanup, a due sync for a recovered account can start when no live RUNNING remains (or after sweeper).

## Acceptance criteria

- [x] Cleanup keeps newest RUNNING per account; older twins become TIMEOUT with an explicit cleanup message
- [x] Unique index ensure runs after cleanup and succeeds when twins are gone
- [x] Re-running cleanup/index ensure is idempotent
- [x] Document how/when ops runs this (script or startup ensure path consistent with existing sync-history index setup)

## How to test

1. Seed two RUNNING docs for one account in a non-prod Mongo (or memory harness if cleanup is store-level).
2. Run cleanup; expect one RUNNING left, older → TIMEOUT.
3. Ensure unique index; expect success.
4. Attempt a second create-running; expect conflict/skip from slice 01 behavior.
5. Re-run cleanup; expect no further changes.
