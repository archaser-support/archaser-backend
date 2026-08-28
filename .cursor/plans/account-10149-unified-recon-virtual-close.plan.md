# Account 10149 — single recon virtual-close rule

## Goal

`IDG_ARFNCITEMS4` only returns closed AR lines. Any reconciled row
(`FRECONNUM` + invoice + `BAL=0`) must settle the invoice in Archaser with
**one** mechanism: virtual payment for remaining (full net if no real payment,
or the shortfall if partial).

## Decisions

| # | Decision |
|---|----------|
| D1 | Single close path: virtual fill for remaining + normal paid recalc |
| D2 | Eligibility: `FRECONNUM` + invoice number + `BAL=0` (no `CREDIT1≠0` gate) |
| D3 | Drop positive debit rows from payment import; queue IVNUM for flush virtual close |
| D4 | Linked receipts / Helam cancels use `afterPaymentLinked` → same virtual fill |
| D5 | Remove Helam offset pair stamp-close |
| D6 | Remove `isForcePaidClose` from account 10149 (duplicate of virtual + recalc) |

## Implementation

1. Broaden `isAccount10149ReconciledClose`; deprecate receipt-only name as alias
2. `transform`: queue dropped recon debit IVNUMs into `pendingInvoiceCloses`
3. `flushPendingInvoiceCloses` → `applyReconciledVirtualClosesForInvoiceNumbers` + recalc
4. Delete `helamOffsetClose.ts`
5. Update admin panel copy

## Codebase scan

**Required:** `reconciledVirtualClose.ts`, `account_10149/index.ts`, `extensions/types.ts`, `Account10149Panel.tsx`, this plan.

**No change:** schema, importPaymentService hooks (still call afterPaymentLinked / optional force-paid), staged sync flush wiring.
