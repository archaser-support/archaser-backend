# 02 — Batch CPT writes and per-run cache

**Status:** done  
**Priority:** high  
**Blocked by:** [01-range-ledger-preload](01-range-ledger-preload.md)  
**User stories:** 1, 2, 4, 16, 21, 22, 23, 26, 28  
**PRD:** `.cursor/plans/portfolio-health-generate-performance.prd.md`

## What to build

Speed up CustomerPolicyTrend snapshot writes during Generate by **batching upserts** and resolving **static per-run context once** instead of re-querying on every day.

Deliver end-to-end:

1. **Job-scoped context object** — Built when the backfill job starts (or first day), cached for the whole run: invoice paid tolerance, account currency, active customer policies query result shape, `hasTopUpPolicies`, MEP breach start date, snapshot scope list, business unit ids. Thread through CPT sync and dashboard writers via options/context parameter — not globals.
2. **Batch CPT persistence** — Accumulate computed CustomerPolicyTrend row payloads in the account sync writer and flush with chunked `INSERT … ON CONFLICT DO UPDATE` (tunable chunk size). Same columns and conflict keys as today; deterministic per-customer computation order unchanged.
3. **Capacity gap ensure once per job** — Run `ensureCustomerCapacityGapStored` for distinct customers at job start (existing concurrency pattern), not inside every day's loop. Confirm gap stored values are safe for historical replay before skipping per-day ensure entirely.

Generate must still produce identical CPT row content to the pre-batch path for the same inputs.

## Acceptance criteria

- [x] CustomerPolicyTrend sync performs chunked multi-row upserts instead of one round-trip per customer-policy per day.
- [x] Invoice paid tolerance, MEP breach start date, and other static account inputs are resolved once per Generate run, not per day.
- [x] Capacity gap ensure runs at most once per customer per job (not every day).
- [x] Portfolio Health and credit dashboard charts unchanged vs slice 01 baseline for the same account and range.
- [x] Nightly CPT cron can reuse the same batched writer and context pattern.

## How to test

1. Use an account with many customer-policy rows (50+).
2. Run Generate for a 14–30 day range; note total duration vs slice 01 alone.
3. After completion, spot-check CustomerPolicyTrend rows for mid-range and end dates — usage, limits, daily cost, breach flags match expectations.
4. Compare Portfolio Health utilization and health-index charts to values recorded after slice 01; no drift.
5. Run Generate on an account **without** top-ups — job completes without top-up resolver errors and faster than many-customer top-up account.
6. Pause and Retry mid-run — batched writes do not corrupt partial days; checkpoint behavior intact.
