# 02 — Delay 10149 recon virtual close until cash payment date

**Status:** done  
**Priority:** high  
**Blocked by:** [01-as-of-settle-and-maturity](01-as-of-settle-and-maturity.md)  
**User stories:** 3, 4, 10  
**PRD:** `.cursor/plans/future-payment-settle-gate.prd.md`

## Goal

When account 10149 imports a reconciled row whose covering cash `FNCDATE` / `payment_date` is still in the future, do not upsert an effective virtual fill or mark Paid on import day. On sync maturity after that date, run virtual fill + Paid as today.

## Scope

- `pendingInvoiceCloses` / `flushPendingInvoiceCloses` / `reconciledVirtualClose` behavior for future-dated cash.
- Re-queue or re-run virtual close from maturity using the shared as-of rule from slice 01.

## Out of this slice

- Collection open skip (slice 03).
- Changing `RECONDATE` pull watermark.

## How to test

1. On account 10149, sync a reconciled payment whose cash `FNCDATE` is after today and linked to an open invoice.
2. Confirm cash row is stored, invoice is not Paid, and no effective virtual settlement has zeroed outstanding yet.
3. Advance as-of / set payment_date to today and run connector sync maturity.
4. Confirm virtual fill (if needed) + Paid close complete.
