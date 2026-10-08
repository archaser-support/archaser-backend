# 01 — Wire live fee rates on Customer (+ Customer Policies display)

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 7, 8
**PRD:** `.cursor/plans/report-builder-fee-rates.prd.md`

## What to build

Make **Insurance Fee Rate (%)** and **Registration Fee (%)** populate correctly on Customer-primary reports (and when Customer is joined from Invoice or similar) from the **live active customer–policy** row, falling back to the linked **insurance policy** when the customer–policy value is empty.

Keep metadata placement: on Customer, both rates stay in the cost cluster after Cost Calculation Method; on Customer Policies, keep them after exclusion fields and before Capacity Gap. Confirm Customer Policies still shows real column values for both rates.

Both rates must go through the same active customer–policy report helper path (select + extract + fallback) so display and later filter work share one resolution rule.

## Acceptance criteria

- [ ] Customer report columns for Insurance Fee Rate (%) and Registration Fee (%) show the active customer–policy value when present
- [ ] When the customer–policy rate is empty, the column shows the linked insurance policy rate (both fields)
- [ ] Invoice (or similar) report with joined Customer fee-rate columns shows the same values for that invoice’s customer
- [ ] Customer field order remains Cost Calculation Method → Insurance Fee Rate (%) → Registration Fee (%) → Policy Cost Snapshot Date
- [ ] Customer Policies report still lists both rates after exclusion / before Capacity Gap with correct values
- [ ] Null stays an empty cell (not coerced to 0)

## How to test

1. On a credit-insurance account, open Settings for a Primary policy and note Insurance Fee Rate (%) and Registration Fee (%).
2. Pick a customer on that policy whose customer–policy rates match the policy (or clear the customer–policy rates so fallback applies).
3. Report Builder → Customer report → add Insurance Fee Rate (%) and Registration Fee (%). Run the report.
4. Expect both columns filled with the live rates (or policy fallback when customer–policy is blank).
5. Build an Invoice report, join Customer, add the same two fields; expect values for that invoice’s customer.
6. Open a Customer Policies report with both rate columns; expect rates on assignment rows (Registration Fee empty on Top-Up rows is OK).
