# Account 10149 — single recon virtual-close rule

## Goal

`IDG_ARFNCITEMS4` only returns closed AR lines. Any reconciled row
(`FRECONNUM` + invoice + `BAL=0`) must settle the invoice in Archaser with
**one** mechanism: virtual payment for remaining (full net if no real payment,
or the shortfall if partial). Customer-linked rows also import as real cash
(including VAT/tax ledger lines).

## Decision log (grill)

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | What “in the payment fetch” means for close | Any reconciled row closes via virtual by invoice number; real cash optional | Closed-only feed semantics |
| D2 | Real cash vs virtual | Import cash when we can, and always queue virtual close | Cash history + guaranteed close |
| D3 | When to queue virtual | On every reconciled row with an invoice number | Covers credit/VAT unlinkable cases |
| D4 | Helam two-invoice offsets | Queue virtual for both `IVNUM` and `FNCIREF1`; remove stamp-close | Single close mechanism |
| D5 | Real cash eligibility | ~~Only clear customer receipts — not VAT/GL~~ | **Superseded by D7** |
| D6 | VAT / ledger detection | ~~Exclude known VAT ACCNAME codes~~ | **Superseded by D8** |
| D7 | VAT lines as cash | Yes — import as cash too; virtual covers remaining | VAT GL lines become real payments |
| D8 | ACCNAME exclude gate | Remove entirely | No VAT account block on cash import |
| D9 | KPI / paid totals | Treat like any other payment | Same recalc; virtual only for remaining |

## Implementation

1. Every reconciled row queues `pendingInvoiceCloses` (IVNUM; Helam offset also FNCIREF1)
2. Cash import gate: `shouldImportAccount10149CashPayment` — customer required (`IDG_CUSTNAME` / `IDC_CUSTNAMEIV`), not positive debit / CR* / Helam offset cancel — **no ACCNAME denylist**
3. `flushPendingInvoiceCloses` → virtual fill + recalc only (no Helam stamp)
4. Delete `helamOffsetClose.ts`
5. Admin panel + import script wiring

## Codebase scan

**Required:** `reconciledVirtualClose.ts`, `account_10149/index.ts`, `extensions/types.ts`, `stagedExtensionSync.ts`, `pendingCloseProgress.ts`, `Account10149Panel.tsx`, import script, this plan.

**No change:** schema, importPaymentService hooks (still call afterPaymentLinked).
