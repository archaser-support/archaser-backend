# 02 — Honest sync status when balances fail

**Status:** done
**Priority:** high
**Blocked by:** [01-reliable-rollup-host-load](01-reliable-rollup-host-load.md)
**User stories:** 3, 4, 5, 10, 18, 21, 25
**PRD:** `.cursor/plans/prevent-stale-overdue-rollups.prd.md`

## What to build

When the customer balance / rollup step (`_balances`) ends in `failed` after invoices or virtual closes changed Paid state, the connector sync execution must **not** complete as `SUCCESS`.

Prefer terminal `FAILED` when balances were required for the run’s affected customers; `PARTIAL` only if the product already uses that status for mixed outcomes and UI/alerts treat it as non-green. Keep `sample_errors` / error text on `_balances` entity stats. Do not swallow balances failure as a soft log-only event on the happy path.

Ensure cancelled or partial syncs that already stamped Paid still attempt rollup refresh or leave a non-success status. Non-SUCCESS must emit the same observability / alert path as other sync failures. Briefly document near sync completion rules that soft-failing balances must not return.

## Acceptance criteria

- [x] Balances step `failed` ⇒ execution terminal status is not `SUCCESS`
- [x] `_balances` entity stats retain error / sample_errors visible in sync history
- [x] Alerts / observability treat balances failure like other sync failures (non-green)
- [x] Healthy incremental sync with balances `done` can still end `SUCCESS`
- [x] Completion rules note that swallowing balances errors as SUCCESS is forbidden

## How to test

1. Force a balances failure (mock/injected callback throw, or temporarily break load in a controlled env). Run sync that would refresh customers.
2. Open sync history: expect terminal status FAILED or PARTIAL (not SUCCESS); `_balances` shows failed with the error message; pending closes / Paid progress still visible distinctly.
3. Confirm alert/notification path fires for non-SUCCESS (same as other sync failures).
4. Regression: healthy sync with balances `done` still ends SUCCESS.
