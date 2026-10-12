# 04 — Stale rollup reconciliation + cohort repair

**Status:** done
**Priority:** normal
**Blocked by:** [01-reliable-rollup-host-load](01-reliable-rollup-host-load.md)
**User stories:** 14, 15, 16, 17, 22, 24
**PRD:** `.cursor/plans/prevent-stale-overdue-rollups.prd.md`

## What to build

Add a periodic reconciliation job (existing cron family) that finds customers whose denormalized overdue (and optionally due) rollups disagree with live Overdue/Due invoice counts, then recalculates them via the **same** `recalculateCustomerAmounts` path used by sync. Bound batch size; respect frozen accounts if sibling crons already do.

Include a one-time / ops repair path for the known Sep 17 virtual-close stale cohort on staging (and production equivalent if present), plus the existing one-customer recalc scripts or admin path so a single ticket can be unblocked without waiting for the cron.

Keep logs free of secrets and connection strings. Scope triage to affected customers — incremental sync touching other customers must not be blamed for unrelated stale rows.

## Acceptance criteria

- [x] Reconciliation cron detects rollup vs live Overdue (and/or Due) mismatches and recalculates those customer ids
- [x] Repair uses the same recalculate entry as sync (no forked math)
- [x] Batch size bounded; frozen-account guard honored when applicable
- [x] One-time/ops path can repair the known Sep 17 cohort (and optionally account-wide fully stale customers)
- [x] Existing one-customer recalc remains usable for a single ticket
- [x] Logs do not include secrets or full connection strings

## How to test

1. Seed or find a customer with `number_of_overdue_invoices` &gt; 0 and zero live Overdue invoices.
2. Run the reconciliation job (or invoke the handler for that account). Expect rollups recalculated to match live (0 / 0).
3. Run one-customer recalc for a known stale id; expect same outcome.
4. After deploy on staging: repair the Sep 17 virtual-close cohort; spot-check customer 21137 (or listed ids) overdue card and list agree.
5. Confirm a healthy unrelated customer is not rewritten solely because another cohort was stale.
