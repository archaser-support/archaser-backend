# 02 — Issue Claim from invoices (eligibility)

**Status:** done
**Priority:** high
**Blocked by:** [01-claim-schema-domain-api](01-claim-schema-domain-api.md)
**User stories:** 1–5, 13–14, 24
**PRD:** `.cursor/plans/claims-tracking.prd.md`

## What to build

Add an **Issue Claim** action on the invoices list that calls the claim-create path with hard eligibility: open amount greater than Primary NQL when NQL is set, invoice overdue, reporting breach true, and no existing claim for that invoice. On success, create a Draft claim owned by Primary with default recognized loss = open × insured % (editable later on the Claims page). Show clear errors when a check fails. Ship EN+HE copy for the action and errors.

## Acceptance criteria

- [x] Issue Claim appears on the invoices list for credit-insurance accounts
- [x] Eligible invoice creates a Draft claim and surfaces success
- [x] Ineligible invoice is blocked with a clear reason (NQL, overdue, reporting breach, or already claimed)
- [x] Default recognized loss matches open × insured %
- [x] English and Hebrew strings added together

## How to test

1. On a credit account, open the invoices list with an overdue, reporting-breached invoice whose open amount exceeds NQL and has no claim.
2. Click Issue Claim — Draft claim exists; recognized loss defaults correctly.
3. Repeat on the same invoice — blocked as already claimed.
4. Try an invoice that is not overdue or not reporting-breached or below NQL — blocked with the matching message.
5. Switch UI to Hebrew — action label and error text appear in Hebrew.
