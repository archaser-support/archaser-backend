# Account 10149 — recon reference force-paid close

## Goal

Any Priority payment whose stored `reference` starts with a recon number
(`FRECONNUM|FNCNUM…`, e.g. `801|26002919|1`) force-closes the linked invoice at
recalc: paid totals = invoice net, outstanding = 0, status = Paid.

Works for receipts and Helam cancels, including Payment→Invoice deferred
maturity (no reconstructed `DEBIT1`/`CREDIT1` required).

## Decisions

| # | Decision |
|---|----------|
| D1 | Generic recon-ref → `isForcePaidClose` (not Helam-only) |
| D2 | Detection: `/^\d+\|/` on `InvoicePayment.reference` |
| D3 | Keep virtual shortfall fill for `CREDIT1≠0` receipts |
| D4 | Drop Helam-cancel-only stamp / skip-recalc path |
| D5 | Unchanged payment re-sync still marks invoice for recalc |

## Implementation

1. `ExtensionLinkedPayment.reference`
2. Recalc select includes `reference`
3. `isAccount10149ForcePaidClose` + wire on extension
4. `afterPaymentLinked` receipt virtual only
5. Skip path `markRecalc` for linked unchanged payments

## Codebase scan

**Required:** types, linkDeferredPaymentAndRecalc, account_10149/index, importPaymentService, Account10149Panel, this plan.

**No change:** schema, Helam pair transform/flush, positive debit drop.
