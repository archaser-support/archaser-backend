---
name: Invoice close date and last payment date
overview: Add Invoice.close_date, maintain last_payment_date on Paid writers, expose both in report builder, and backfill via datafix script.
isProject: false
---

# Invoice close date and last payment date

**ClickUp:** [Add invoice close date and last payment date to invoice table](https://app.clickup.com/t/869eymd4h)

## Decision log (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Last Payment Date | Reuse existing `last_payment_date`; maintain + backfill |
| D2 | Close semantics | Paid only; Cancelled/Void stay null |
| D3 | Storage | Stored `close_date` column |
| D4 | Payments | `MAX(payment_date)` including virtual |
| D5 | Leave Paid | Clear `close_date`; refresh last payment from remaining payments |
| D6 | Paid, no payments | Both dates = `modified_at` calendar day |
| D7 | Manual dialog | If Paid, set `close_date` to the same date |
| D8 | Data fix | Overwrite from payment rules |
| D9 | UI | Report builder for close date; keep last-payment dialog; no new grids |
| D10 | Writers | Same rules on recalc, cron, import (when writing Paid), manual API |
| D11 | Column name | `close_date` |
| D12 | Data fix vehicle | `scripts/datafixes/backfill-invoice-close-and-last-payment-dates.ts` |
| D13 | Index | `@@index([account_id, close_date])` |

## Implementation

1. **Schema** — `prisma/schema.prisma` + `prisma/migrations/20260923_invoice_close_date.sql`
2. **Helper** — `packages/billing-connector/src/invoice/invoicePaymentCloseDates.ts`
3. **Writers** — payment recalc bulk SQL, `fixClosedCollectionData`, invoice import (Paid create/promote), manual last-payment API
4. **Report builder** — `close_date` in `reports/src/reports/report-metadata.ts`; EN/HE `invoices.close_date`
5. **Data fix** — dry-run / fix script (optional `--account`)

## Out of scope

- Invoice list/grid columns
- As-of open AR rewrite (keeps historical `MAX(payment_date)` as-of day)
- Cancelled/Void close dates

## How to test

1. Apply migration SQL; regenerate Prisma client.
2. Link payments until an invoice becomes Paid → `last_payment_date` and `close_date` = max payment date.
3. Unlink so status leaves Paid → `close_date` null; `last_payment_date` still max of remaining.
4. Report builder → Invoice → add Invoice Close Date + Last Payment Date; filter/sort/export.
5. `npx tsx scripts/datafixes/backfill-invoice-close-and-last-payment-dates.ts --dry-run` then `--fix`.
