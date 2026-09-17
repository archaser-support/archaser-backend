# 01 — Reliable rollup host load + boot check

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 6, 7, 8, 9, 20, 23
**PRD:** `.cursor/plans/prevent-stale-overdue-rollups.prd.md`

## What to build

Make customer due/overdue rollup refresh load reliably in the billing-connector worker (and any host that uses the same host loader), so virtual closes and cash payments share the same post-Paid rollup guarantee.

Prefer a durable strategy: shared module / normal import, or an injected `onCustomerBalancesFinal` from the Nest/worker host that imports the compiled customers domain directly. Keep dynamic host resolution only as fallback. Always support `CUSTOMERS_DOMAIN_ROOT`, resolve known workspace layouts, and **throw** if none load.

Add a boot-time (or first-sync-accept) check that rollup refresh can load; fail fast with a clear error rather than running Payment / pending closes first. Document the deploy contract (image must include the artifact the chosen strategy needs; env override when used).

## Acceptance criteria

- [x] Worker/host can invoke rollup refresh without depending on a single fragile `__dirname` walk that breaks in staging/production layout
- [x] Missing module / unresolvable root throws (does not silently skip)
- [x] Boot or first-accept check refuses sync work when rollup refresh cannot load, with a clear error
- [x] `CUSTOMERS_DOMAIN_ROOT` (or chosen shared package) is documented for deploy
- [x] Virtual-close and normal payment finalize paths use the same loadable rollup entry

## How to test

1. Deploy or run the worker with a layout matching staging (or unset/wrong `CUSTOMERS_DOMAIN_ROOT` that previously broke). Confirm boot/first-accept fails loudly if the module is missing.
2. With a correct layout or injected host callback, run incremental sync that touches customers (payment or pending closes). Confirm `_balances` reaches `done` and customer `number_of_overdue_invoices` / `total_overdue_amount` update after Paid.
3. Set `CUSTOMERS_DOMAIN_ROOT` to a valid customers domain root; confirm load succeeds. Point it at a bogus path; confirm throw / boot failure (not SUCCESS with skipped rollups).
