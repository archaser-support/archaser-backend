# 01 — Reconcile sync mode (promote, repair, demote)

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16
**PRD:** `.cursor/plans/billing-sync-mode-flip.prd.md`

## What to build

Ship the connector **sync mode reconcile** so finished full-account backfills become Incremental and stuck accounts heal without a new API.

- Shared reconcile rules: promote to Incremental only when every **enabled** entity is `backfill_completed` and the run is not customer-scoped; never require disabled entities (e.g. Contact on credit).
- Apply at **end of in-process sync** and on **billing connector config GET** (repair).
- On save, if Incremental and newly enabled entities are incomplete, **demote to Backfill** (keep existing entity completion rows).
- After promote, existing **Run incremental sync now** and scheduled Sync Billing Connectors due path work without new endpoints.

## Acceptance criteria

- [x] Full-account backfill that completes all enabled entities sets `sync_mode` to INCREMENTAL
- [x] Customer-scoped backfill never promotes to INCREMENTAL
- [x] Credit (or any account) without Contact in `enabled_entities` can still promote
- [x] Config GET repairs stuck BACKFILL connectors whose enabled entities are already complete
- [x] End of sync promotes when the last enabled entity completes
- [x] Enabling a new incomplete entity while INCREMENTAL demotes to BACKFILL
- [x] No new “run daily sync” API is introduced

## How to test

1. Use an account whose enabled entities all show backfill completed but the primary button still says **Start backfill**.
2. Open Admin → Account Details → Billing integration (reload config).
3. Expect config `sync_mode` Incremental and primary action **Run incremental sync now**.
4. Run incremental once; expect success and history entry.
5. Enable an additional entity that was off; save; expect mode Backfill and Start/Resume backfill again.
6. Complete full-account backfill for that entity; expect mode Incremental again.
7. Optional: run a single-customer Start on a Backfill account and confirm mode stays Backfill.
