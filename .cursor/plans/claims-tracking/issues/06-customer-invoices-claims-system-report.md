# 06 — Customer invoices claims system report

**Status:** done
**Priority:** normal
**Blocked by:** [01-claim-schema-domain-api](01-claim-schema-domain-api.md)
**User stories:** (grill session) invoices-with-claims report under customer invoices tab
**PRD:** `.cursor/plans/claims-tracking.prd.md`

## What to build

Add a **system report** on the customer **Invoices** tab listing Due/Overdue invoices that have a claim (any claim status). Credit product only (`unique_name` contains `credit_insurance`). Wire the customer-header **View claims** banner to open this report via `?tab=invoices&reportId=…` instead of the claim modal. Tighten the banner count to open claims on Due/Overdue invoices only.

## Acceptance criteria

- [x] System report seeded for all accounts with unique_name `customer_unpaid_invoices_credit_insurance_claims`
- [x] Report hidden from non-credit accounts via existing reports list filter
- [x] Report shows invoice columns + claim status, recognized loss, submission date, insurer reference
- [x] Filters: Invoice status Due/Overdue + Claim exists (no outstanding &gt; 0 requirement)
- [x] Invoice→Claim join registered in report metadata / relationships / execution map
- [x] View claims navigates to invoices tab + selects this report; toast if report missing
- [x] Banner counts only open claims on Due/Overdue invoices
- [x] EN+HE copy for missing-report toast

## How to test

1. Run `scripts/database/create-customer-unpaid-invoices-claims-report.sql` (or sync system reports from master).
2. On a credit account with a Due/Overdue invoice that has an open claim: customer header shows the open-claims banner.
3. Click **View claims** → Invoices tab opens on **Invoices with Claims**; rows match unpaid invoices with claims; claim columns visible.
4. Non-credit account: report does not appear in the invoices view dropdown.
5. Open claim only on a Paid invoice: banner does not show (or count excludes it).
6. If the system report is not seeded: View claims shows an error toast and does not open the claim modal.
