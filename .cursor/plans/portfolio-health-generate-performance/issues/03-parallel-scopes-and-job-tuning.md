# 03 — Parallel dashboard scopes and job tuning

**Status:** done  
**Priority:** normal  
**Blocked by:** [02-batch-cpt-and-run-cache](02-batch-cpt-and-run-cache.md)  
**User stories:** 3, 5, 6, 8, 9, 17, 24, 25, 27, 29, 30  
**PRD:** `.cursor/plans/portfolio-health-generate-performance.prd.md`

## What to build

Reduce remaining per-day overhead in Generate: parallel dashboard snapshot scopes, batched auxiliary queries, and throttled checkpoint writes.

Deliver end-to-end:

1. **Parallel dashboard scopes** — Within each day, after as-of lines are ready, run `getCreditDashboardSummary` + daily snapshot upsert for each scope (account-wide, per-policy, × business units) with **bounded concurrency** (env-configurable default, e.g. 4–8). All scopes share the same `asOfLines` and ignore-reporting-breach overlay.
2. **Bulk predecessor fallbacks** — Before the CPT per-customer loop each day, bulk-load missing prior-day trend rows needed for daily cost delta instead of per-customer fallback queries.
3. **Batch effective approved limit** — For top-up accounts, resolve limits for all relevant customers in one batched path instead of await-per-customer inside the CPT loop.
4. **Checkpoint throttling** — Update `CreditAsOfBackfillJob` `days_done` / `checkpoint_date` on a minimum interval (e.g. every 5 seconds or every N days); still check pause status each day. Always flush checkpoint immediately on failure or completion.
5. **Optional observability** — Structured log or metric for per-day duration and scope count during Generate (no PII).

## Acceptance criteria

- [x] Dashboard daily snapshot scopes for a day process with bounded parallel concurrency; upserted rows match sequential baseline for the same day and scopes.
- [x] Predecessor cost fallback queries are bulk-loaded; no per-customer fallback query storm on sparse history.
- [x] Top-up effective limit resolution is batched for accounts with top-ups.
- [x] Job checkpoint updates throttled but monotonic; progress bar still advances; pause honored between days; Retry resumes correctly.
- [x] Accounts with many policies and business units show disproportionate wall-clock improvement vs slice 02.

## How to test

1. Use an account with **multiple policies and 3+ active business units**.
2. Run Generate for 14 days; watch progress bar — should advance smoothly (may jump in steps due to throttling).
3. After completion, verify CreditDashboardDailySnapshot rows exist for account-wide and policy-scoped keys for sample days.
4. Compare credit dashboard trend and Portfolio Health to pre-slice-03 baselines — no metric drift.
5. Start Generate, click **Stop** mid-run — job pauses after current day; **Retry** continues; final state consistent.
6. On a top-up account, confirm utilization/limit fields in CPT rows match expectations (batch limit path correct).
7. Check server logs for per-day timing entries during the run (if observability added).
