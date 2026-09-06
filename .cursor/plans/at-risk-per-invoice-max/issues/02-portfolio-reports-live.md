# 02 — Portfolio + report live enrichment

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [01-shared-formula-customer-kpis](01-shared-formula-customer-kpis.md)
**User stories:** 7, 8, 9, 16
**PRD:** `.cursor/plans/at-risk-per-invoice-max.prd.md`

## What to build

Wire portfolio credit-dashboard at-risk and report `at_risk_exposure` enrichment to the shared per-invoice max sum. Remove the portfolio policy max-cover residual so portfolio at-risk is the sum of customer (invoice-scoped) at-risk under the new rule.

## Acceptance criteria

- [ ] Portfolio at-risk matches the sum of in-scope customer at-risk under the new formula
- [ ] No extra policy residual is added on top of customer sums
- [ ] Report enrichment `at_risk_exposure` matches the same formula for insured vs uncovered customers

## How to test

1. On the credit dashboard, note portfolio At Risk for a scope that includes known customers.
2. Sum those customers’ At Risk cards (or reconcilable invoice max sums).
3. Expect portfolio At Risk to equal that sum (within FX/scoping rules already used for the dashboard).
4. Run or open a report that includes `at_risk_exposure` for an insured and an uncovered customer; expect values to match the new rule.
