# Billing sync — new customer history backfill

**PRD:** `.cursor/plans/billing-new-customer-history.prd.md`

When incremental billing sync creates new customers, enqueue durable per-customer history from `backfill_start_date`, drain before the next incremental, keep the connector on INCREMENTAL, and isolate progress from account sync cursors/watermarks.

Vertical slices live under `issues/`. Implement in dependency order; prefer a **fresh session per slice**.

| # | Title | File | Waiting on |
|---|-------|------|------------|
| 1 | Isolate customer-scoped history progress | `issues/01-isolate-customer-history-progress.md` | — |
| 2 | Pending-history queue + enqueue on create | `issues/02-pending-queue-and-enqueue.md` | 01 |
| 3 | Drain-before-incremental orchestration + failure policy | `issues/03-drain-orchestration-and-failures.md` | 01, 02 |
