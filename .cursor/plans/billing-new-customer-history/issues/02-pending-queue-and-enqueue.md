# 02 — Pending-history queue + enqueue on create

**Status:** done
**Priority:** high
**Blocked by:** [01-isolate-customer-history-progress](01-isolate-customer-history-progress.md)
**User stories:** 1, 3, 4, 5, 13, 16, 17, 19
**PRD:** `.cursor/plans/billing-new-customer-history.prd.md`

## What to build

Add a durable pending-history queue for billing connectors. When an INCREMENTAL sync **creates** a customer during Customer import, enqueue that customer (idempotent). Do not enqueue on updates, and do not enqueue while the connector is in account-wide BACKFILL.

Expose pending / needs-attention counts and customer ids on connector sync status/API, and emit structured logs for enqueue. Clearing a row on successful history can land in slice 03 if drain is not wired yet; at minimum success-clear API/helper should exist for the drain slice to call.

## Acceptance criteria

- [x] Durable store for pending-history rows with states needed for pending / in_progress / needs_attention, attempt_count, last_error, and scoped progress fields (as required by slice 01)
- [x] Customer **create** on INCREMENTAL import enqueues; **update** does not
- [x] No enqueue when connector `sync_mode` is BACKFILL
- [x] Re-create / duplicate enqueue is idempotent
- [x] Connector status/API includes pending count and ids (and needs-attention fields even if always empty until slice 03)
- [x] Structured log on enqueue

## How to test

1. On an INCREMENTAL staging connector, run sync such that at least one new ERP customer is created.
2. Confirm a pending-history row exists for that customer and status/API shows pending count ≥ 1.
3. Re-run incremental that only updates that customer; confirm no duplicate pending row.
4. On a connector still in account BACKFILL, create/import a new customer during backfill; confirm no enqueue.
5. Confirm logs show the enqueue event with connector/customer identifiers (no secrets).
