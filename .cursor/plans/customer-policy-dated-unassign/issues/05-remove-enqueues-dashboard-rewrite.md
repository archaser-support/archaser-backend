# 05 — Remove rebuilds past dashboard days

**Status:** done
**Priority:** normal
**Blocked by:** —
**User stories:** 57
**PRD:** `.cursor/plans/customer-policy-dated-unassign.prd.md`

## What to build

After a past-dated or today Remove (and after a due pending unassign is applied), add the customer (and mirrored credit-pool descendants) to the rewrite queue with `enqueueAsOfRewrite` from the unassign day through today. The overnight `drainAsOfRewriteQueue` then rebuilds the credit dashboard snapshot days with the existing shared day writer (`takeCreditDashboardDailySnapshotsForAccount`). Keep the in-request Customer Policy Trend rewrite as is. Pending activation already enqueues; do not enqueue twice for the same apply. Do not change dated policy saves.

## Acceptance criteria

- [ ] Past/today Remove leaves one queue item for the customer (and descendants) from the unassign day
- [ ] Due pending unassign activation enqueues once, not twice
- [ ] After the queue replay, past dashboard days no longer count invoices issued on/after the unassign day as insured
- [ ] Future Remove (pending) does not enqueue on save

## How to test

1. Remove policy for a customer with past date X.
2. Check the rewrite queue: one item for that customer from X to today.
3. Run the Customer Policy Trend daily job (it drains the queue).
4. Open the credit dashboard history for a day after X. Expect the customer's invoices issued on or after X counted as without policy, not insured exposure.
