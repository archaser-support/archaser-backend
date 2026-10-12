# 06 — Data fix for removes that already happened

**Status:** done
**Priority:** normal
**Blocked by:** [04-policy-chart-cpt-rollup](04-policy-chart-cpt-rollup.md), [05-remove-enqueues-dashboard-rewrite](05-remove-enqueues-dashboard-rewrite.md)
**User stories:** 58
**PRD:** `.cursor/plans/customer-policy-dated-unassign.prd.md`

## What to build

One-time script under `scripts/datafixes/` (next to `backfill-customer-policy-end-dates.ts`). Find every customer already removed: an inactive `CustomerPolicy` with an insurance policy, `policy_change_end_date` after its start, no active version, and no later version starting on that end date. For each customer, from its remove date through today: run the slice 04 policy chart roll-up for the affected policy and days, and enqueue the rewrite queue (slice 05) so the overnight run rebuilds dashboard days. Dry-run by default (list customers, remove dates, day counts per account); apply only with an explicit flag. Skip accounts with a running or paused credit as-of backfill job. Old versions' `modified_at` overwritten by earlier removes cannot be restored; out of scope.

## Acceptance criteria

- [ ] Dry run lists every already-removed customer with its remove date and policy, writes nothing
- [ ] Apply rebuilds the policy chart days and enqueues dashboard days from each remove date
- [ ] Running apply twice is safe (same results, no duplicate queue growth beyond a merge)
- [ ] Accounts blocked by an admin backfill job are skipped and reported

## How to test

1. Run the script in dry-run mode. Expect customer 21108 listed with remove date July 30 and its policy.
2. Run with the apply flag.
3. Open the 21108 policy's chart for Aug 20. Expect 21108 counted only with run-off (invoices issued before July 30, base limit).
4. Run the Customer Policy Trend daily job (drains the queue). Open the credit dashboard history for Aug 20. Expect 21108's invoices issued on or after July 30 counted as without policy.
