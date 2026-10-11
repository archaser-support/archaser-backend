# 04 — Policy chart rolled up from Customer Policy Trend

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 55, 56
**PRD:** `.cursor/plans/customer-policy-dated-unassign.prd.md`

## What to build

Build the policy-level chart (`InsurancePolicyTrend`) for a day by adding up that day's Customer Policy Trend rows for the policy, including run-off rows, instead of looping over customers whose version is active right now (`computePolicyRollups` in `insurancePolicyTrendService.ts`). Expose one shared roll-up that takes an account, a day (or day range), and optional customer / policy scope. Call it:

- after every Customer Policy Trend rewrite, for the rewritten days (`rewriteCustomerAsOfRange` in-request and `drainAsOfRewriteQueue` replay);
- in the daily Customer Policy Trend cron handler, for today, after today's tip.

The separate Insurance Policy Trend daily handler must not overwrite those totals with live-only numbers. Either it calls the same roll-up, or it writes only the fields not on Customer Policy Trend. Policy-level inputs that are not per customer (e.g. `max_total_cover` for usage %) still come from the policy row. Country and named trend rows are out of scope.

## Acceptance criteria

- [ ] For any rewritten day, TF1 customer count, approved limit and open AR equal the sum of that day's TF1 Customer Policy Trend rows
- [ ] Run-off rows (inactive version with end date) count toward TF1 on days after a Remove
- [ ] Today's daily write uses the same roll-up; the Insurance Policy Trend handler does not undo it
- [ ] Days not touched by a rewrite are unchanged

## How to test

1. Pick customer A on TF1 with unpaid invoices issued before date X. Remove policy with past date X.
2. Open the TF1 policy chart (credit dashboard → policy trend) for a day after X.
3. Expect: TF1 still includes A's run-off open AR (invoices issued before X) and its base limit; it no longer includes A's invoices issued on or after X; totals match the sum of A's and other customers' Customer Policy Trend rows for that day.
4. Run the Customer Policy Trend daily job, then the Insurance Policy Trend daily job. Expect today's TF1 point still includes A's run-off.
