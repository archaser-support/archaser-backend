# 05 — Report builder Claim object

**Status:** done
**Priority:** normal
**Blocked by:** [01-claim-schema-domain-api](01-claim-schema-domain-api.md)
**User stories:** 20
**PRD:** `.cursor/plans/claims-tracking.prd.md`

## What to build

Register **Claim** as a report-builder object with core fields (status, submission date, insurer reference, recognized loss, applied excess amounts, policy year, links to invoice/customer/Primary policy) so analysts can build claim reports. Follow existing report-metadata patterns for credit-insurance entities. EN+HE field labels as required by report metadata conventions.

## Acceptance criteria

- [x] Claim appears as a selectable object in the report builder
- [x] Core claim fields are available and resolve against live claim data
- [x] Account scoping respects the signed-in account
- [x] Labels follow existing EN+HE report metadata patterns

## How to test

1. Open report builder on a credit account that has at least one claim.
2. Create a report on Claim — select status, recognized loss, policy year, and invoice/customer fields.
3. Run the report — rows match the Claims grid for that account.
4. Confirm a non-credit or empty account behaves safely (no cross-account rows).
