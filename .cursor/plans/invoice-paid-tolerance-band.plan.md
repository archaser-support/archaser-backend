# Invoice paid tolerance band (±0.2)

## Problem

`customer_outstanding_debt <= 0.2` marked credit notes Paid (e.g. `CR26100000018` at ≈ −3357) with no payments.

## Decisions

| # | Topic | Decision |
|---|-------|----------|
| D1 | When to mark Paid | Outstanding ∈ **[-0.2, 0.2]** |
| D2 | Which closers | Both cron + payment recalc |
| D3 | Existing bad Paid rows | Leave Paid (forward-only) |
| D4 | Open credit notes | Stay Due/Overdue; negatives reduce due |
| D5 | Implementation | Shared `isWithinPaidTolerance` + `INVOICE_PAID_TOLERANCE` |

## Changes

- `packages/billing-connector/src/invoice/invoicePaidTolerance.ts` — add `isWithinPaidTolerance`
- `packages/billing-connector/src/invoice/linkDeferredPaymentAndRecalc.ts` — `becomesPaid` uses the helper
- `packages/cron-jobs/src/closeZeroOutstandingDebtInvoices.ts` — Prisma filter `gte: -T` and `lte: T`; import `INVOICE_PAID_TOLERANCE` from billing-connector

## Out of scope

- Reopen already-Paid credit notes
- Force-paid / virtual-close behavior
- Due rollup formula changes

## How to verify

1. Credit note with large negative outstanding and no payments → stays Due after cron / does not become Paid on payment recalc with empty links.
2. Invoice with outstanding `0.05` → still closes to Paid.
3. Payment that brings outstanding into ±0.2 → Paid.
