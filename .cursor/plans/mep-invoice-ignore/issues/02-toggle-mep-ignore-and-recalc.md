# 02 — Toggle MEP ignore, refresh gap, enqueue as-of

**Status:** done
**Priority:** high
**Blocked by:** [01-rename-customer-invoice-grid](01-rename-customer-invoice-grid.md)
**User stories:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22
**PRD:** `.cursor/plans/mep-invoice-ignore.prd.md`

## What to build

Add `mep_ignored` on Invoice. From `CustomerInvoiceGrid`, credit-insurance users with a customer policy one-click toggle ignore on unpaid Due/Overdue invoices (hide on credit notes). Skip ignored rows only in `overdue_block` (live and as-of), not in aging, AR, or capacity-gap allocation. After save: existing insurance + capacity-gap pipeline (pool/shell aware), pool breach roll-up, as-of rewrite enqueue, toast, EN+HE copy. ERP re-pull of the same invoice must keep the flag.

## Acceptance criteria

- [x] Toggle persists and survives ERP update of the same invoice
- [x] Ignoring the only MEP-blocking overdue invoice clears leaf `overdue_block`; un-ignore restores it when still overdue in MEP scope
- [x] Header days overdue still include the ignored invoice
- [x] Live capacity gap refreshes on the customer or shell/pool root
- [x] As-of rewrite is enqueued for the affected customers
- [x] Credit notes and Paid invoices cannot be toggled via this action
- [x] Matching English and Hebrew locale keys are added/updated together

## How to test

1. Credit-insurance customer with one overdue invoice past Extra Days: confirm `overdue_block` is on.
2. On the customer Invoices tab, click Ignore for MEP; icon looks on; toast succeeds; overdue_block clears; days overdue still show; capacity-gap card refreshes.
3. If the customer has a shell parent, open the shell and confirm pool overdue_block and capacity gap updated.
4. Click the same action again: ignore off; overdue_block returns.
5. Mark a Due invoice ignored; it stays ignored after it becomes Overdue and does not set overdue_block.
6. Confirm a credit note row has no ignore icon.
7. Switch UI to Hebrew and confirm tooltip/toast.
8. Re-pull or update that invoice from ERP-like sync without expecting the flag to clear.
