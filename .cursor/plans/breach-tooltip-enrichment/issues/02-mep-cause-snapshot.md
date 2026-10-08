# 02 — MEP cause-invoice snapshot in the breach tooltip

**Status:** done
**Priority:** normal
**Blocked by:** [01-sectioned-breach-tooltip](01-sectioned-breach-tooltip.md)
**PRD:** `.cursor/plans/breach-tooltip-enrichment/OVERVIEW.md` (decision log; no PRD)

## What to build

When an invoice is flagged **Customer overdue (MEP) at creation**, freeze a snapshot of the invoice that caused it at the moment the flag is computed (D2, D3), next to the cause invoice number already stored:

- cause invoice **due date**
- cause invoice **outstanding** on the flagged invoice's issue date, in invoice (customer) currency (D8)
- **days past MEP** on the flagged invoice's issue date. Use the same deadline rule as the overdue-block check, including month-end cutoff and extra days.

Store these in new invoice columns, using a migration applied with `prisma db execute`, following the cause-invoice-number migration. Write them on every path that writes the cause invoice number today (live terms refresh, as-of stamping, bulk updates). Include them in the "unchanged → skip" comparisons. Clear them whenever the MEP flag clears.

Already-flagged invoices get the snapshot the next time their terms flags are recomputed (D4). No separate backfill job.

Expose the fields on the customer invoice grid rows and add them to the MEP section from slice 01:

> **Customer overdue (MEP) at creation**
> Caused by: INV-50
> Due date: 12 Mar 2026
> Outstanding then: $4,200
> Days past MEP: 15

The cause invoice stays plain text (D7). Rows without stored values stay hidden, so invoices not yet recomputed keep the number-only view.

## Acceptance criteria

- [x] New invoice columns for cause due date, cause outstanding at the time, and days past MEP, added by an additive migration
- [x] Every path that writes the cause invoice number also writes or clears the snapshot fields; change detection includes them
- [x] Days past MEP matches the overdue-block deadline math (month-end cutoff and extra days included)
- [x] Outstanding is the cause invoice's open amount in customer currency as of the flagged invoice's issue date
- [x] Snapshot does not change when the cause invoice is later paid, unless a recompute changes the flag or the cause (D3)
- [x] Previously flagged invoices get the snapshot on the next terms recompute (D4)
- [x] MEP tooltip section shows all four rows when stored, and the number only when the snapshot is missing
- [x] New labels exist in English and Hebrew

## How to test

1. Apply the migration with `npx prisma db execute --file <new migration>`.
2. Pick a customer with an MEP: an old overdue invoice (INV-50) past MEP, and a newer invoice (INV-200) created after that date.
3. Trigger a terms recompute for the customer, e.g. by editing a customer policy term or running the account recompute/Generate.
4. On the customer page invoice grid, hover the **Contains breaches / violations** icon on INV-200.
5. Expect: "Caused by: INV-50", INV-50's due date, its outstanding then in the invoice currency, and days past MEP.
6. Mark INV-50 paid (or pay it through the connector) and hover INV-200 again. Expect the same snapshot values, unless the recompute removed the MEP flag.
7. Check an MEP-flagged invoice from before the recompute. Expect only "Caused by: <number>" until its flags are recomputed.
