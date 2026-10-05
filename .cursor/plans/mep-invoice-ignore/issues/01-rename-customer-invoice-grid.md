# 01 — Rename to CustomerInvoiceGrid

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 18
**PRD:** `.cursor/plans/mep-invoice-ignore.prd.md`

## What to build

Rename the customer-page invoices tab module from `UnpaidInvoiceList` to `CustomerInvoiceGrid`. Update the dynamic import, component name, cache-invalidation helper name, and comments that still say UnpaidInvoiceList. Keep report context `customer_unpaid_invoices` unchanged. No MEP behavior in this slice.

## Acceptance criteria

- [x] Customer invoices tab still loads from the renamed module
- [x] Callers of the cache helper use the new name
- [x] No leftover imports of `UnpaidInvoiceList`

## How to test

1. Open a customer that has invoices.
2. Open the Invoices tab.
3. Confirm the outstanding invoices grid still loads, search/views work, and existing actions (report / claim / last payment where applicable) still open.
