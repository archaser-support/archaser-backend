# 03 — To-many Invoice scalars (take 1 + unwrap)

**Status:** done
**Priority:** normal
**Blocked by:** [01-explicit-primary-table-config](01-explicit-primary-table-config.md)
**User stories:** 4
**PRD:** `.cursor/plans/report-primary-independent-of-column-order.prd.md`

## What to build

When the primary table is Customer and the report includes Invoice scalar fields (e.g. due date, invoice date) without aggregation, load a single related Invoice (`take: 1`, stable order by id) and unwrap arrays in field extraction so cells show a date instead of staying blank.

Match existing sample-row patterns used for collection period / customer policy. Do not explode the grid into one row per invoice. Aggregated Invoice columns must keep existing aggregation behavior. Contact/Dispute/Activity to-many display can wait unless trivial to include with the same pattern.

## Acceptance criteria

- [x] Customer-primary report with Invoice due date / invoice date shows a date when the customer has invoices.
- [x] Customers with no invoices still show blank date cells (no crash).
- [x] Aggregated Invoice amount/count columns are unchanged.
- [x] Invoice-primary reports are unchanged (still one row per invoice with full dates).

## How to test

1. Open or recreate a Customer-primary report with customer name + Invoice invoice date + due date (like former report 5133).
2. Run the report — date columns show values for customers that have invoices.
3. Confirm a customer with no invoices shows blank dates.
4. Spot-check an Invoice-primary report with the same date fields still lists one row per invoice.
