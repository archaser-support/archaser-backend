# 01 — Isolate customer-scoped history progress

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 14, 15
**PRD:** `.cursor/plans/billing-new-customer-history.prd.md`

## What to build

Make customer-scoped history loads safe to run while the connector stays on INCREMENTAL: progress/cursors for that run must live off account-level `ConnectorSyncState` (or be restored without leaving partial account backfill), must not advance account incremental watermarks from scoped pages, and Resume must keep the same customer scope until that customer’s history finishes.

This is the prefactor that unblocks automated drain. A single customer Start backfill (existing API) should still work, but without corrupting account sync health if interrupted mid-run.

## Acceptance criteria

- [x] Customer-scoped history does not leave account entities in a “partial account backfill” state that drops `customer_id` on Resume
- [x] Account `last_max_updated_at` / incremental watermarks are not rewritten from customer-scoped page maxima
- [x] Interrupted customer-scoped history can resume for the **same** customer only
- [x] Connector remains INCREMENTAL when it started INCREMENTAL
- [x] Existing account-wide Start/Resume backfill behavior for onboard is unchanged

## How to test

1. On a staging connector already on INCREMENTAL, run Start backfill with one known `customer_id`.
2. Cancel or stop mid-entity (or hit a short duration cap if available).
3. Confirm connector status does not look like a broken account-wide partial backfill (Resume still scoped / no widen-to-all).
4. Resume and finish that customer; confirm other customers’ incremental watermarks are unchanged.
5. Run a normal incremental afterward; confirm it still behaves as INCREMENTAL for the account.
