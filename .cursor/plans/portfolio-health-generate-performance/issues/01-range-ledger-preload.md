# 01 — Range ledger preload

**Status:** done  
**Priority:** high  
**Blocked by:** —  
**User stories:** 1, 2, 4, 13, 15, 18, 19, 21, 22, 28  
**PRD:** `.cursor/plans/portfolio-health-generate-performance.prd.md`

## What to build

Replace the per-day `loadAsOfOpenInvoiceCandidates` SQL call inside Generate with a **single range load** at job start, then derive each day's `AsOfOpenInvoiceLine[]` in memory for the existing day loop.

Deliver end-to-end:

1. **Range loader** — One or two queries fetch all invoice candidates with `invoice_date` on or before job `to_date`, plus payment aggregates needed for as-of open AR through the full range.
2. **Pure day filter** — Given preloaded ledger rows and a `snapshotDate`, produce the same line shape and open-amount semantics as today's per-day SQL loader (tolerance, void/cancelled exclusion, payment cutoff at end of UTC day, ignore-reporting-breach overlay still applied downstream as today).
3. **Runner wiring** — `runCreditAsOfBackfillJob` loads the range once, injects a day-filtering `loadAsOfLines` into each day's writers. Day order stays sequential. Nightly cron and admin backfill should be able to reuse the same path when they call the shared writers (no second code path for Generate only).

Correctness is the gate: optimized lines for each day must match the legacy per-day loader for the same account fixture (including partial payments, payments after snapshot day, and credit notes).

## Acceptance criteria

- [ ] Generate loads invoice/payment ledger data once per job, not once per day in the range.
- [ ] For each day in the range, in-memory derivation produces the same open AR inputs to CPT and dashboard writers as the current per-day SQL loader (verified on a representative account or fixture set).
- [ ] Stop, Retry, checkpoint resume, and ignore-reporting-breach behavior unchanged.
- [ ] Both `CustomerPolicyTrend` and `CreditDashboardDailySnapshot` still written for every day; Portfolio Health charts match pre-change outputs for the same range on a fixed test account.
- [ ] Nightly cron writer entrypoints can call the shared loader/filter without duplicating business logic.

## How to test

1. Pick a credit-insurance account with open invoices, partial payments, and at least one invoice paid after a day inside the range.
2. Note Portfolio Health KPIs/chart points for a 7–14 day range **before** the change (or run Generate with the old code and record values).
3. Open `/credit-portfolio-health`, set the same from/to, click **Generate**, wait for completion.
4. Confirm progress advances day-by-day and charts show the **same** values as before for those dates (within normal rounding).
5. Repeat with **Ignore reporting breach** off and on; reporting-late buckets behave as before.
6. Stop mid-run, Retry — job resumes and final charts still match expectations.
7. Compare wall-clock for a 30-day Generate vs baseline; expect noticeable improvement on invoice-heavy accounts (ledger-bound).
