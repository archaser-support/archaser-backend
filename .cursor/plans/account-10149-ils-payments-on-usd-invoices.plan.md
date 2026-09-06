# Account 10149 — ILS receipts against USD invoices

**Status:** in progress — all code done (steps 2–4 plus the deferred-link gap and
the backfill script); **step 1 (invoice mapping) is the only outstanding action**,
and nothing takes effect until it lands.

Dry-run on account 10149 confirms the expected pre-mapping state:
`paymentsScanned: 10930, needingRealignment: 0, skippedNoInvoiceRatio: 78` —
the 78 known rows are found but correctly left alone while their invoices still
carry ratio 1.

### Deferred-payment gap (found after the initial draft)

On a clean backfill where payments import before invoices, the fix in step 4
never runs: `importPayments` takes the deferred branch, and
`applyMaturedDeferredPayments` previously linked rows with an `updateMany`
writing only `invoice_id` / `modified_at` — amounts, currency and the align hook
were never revisited. This is how the 78 bad rows were created.
`rawErpRowFromMaturedPayment` also drops `CODE`/`CODE5`, so re-running the
extension hook there would not have helped.

Fixed by converting at link time via the shared helper (see below), which needs
no ERP currency labels — only the payment's stored base amount and the invoice
ratio.

`IDG_SUM1` verified against customer 4036 invoice `SI260024553`: `4989.44`,
equal to `TOTPRICE`, so the ratio stays 1 for ILS customers and the `base_amount`
mapping change is safe.

## Problem

Account 10149 payment imports log 31–32 `import.validation.paymentCurrencyMismatch`
failures per run. Every failing row belongs to customer `107281867` (id `4114`),
whose 213 invoices are all USD.

Priority books the dual-currency pair on the **invoice/debit** line and only the
ILS side on the **receipt** line. For invoice `SI260009586`:

| Line | Entity | `CODE` / `CREDIT1`,`DEBIT1` | `CODE5` / `CREDIT5`,`DEBIT5` |
|---|---|---|---|
| `KLINE 1` (invoice, `FNCNUM 26074601`) | debit | `ש'ח` / `DEBIT1 496997.42` | `$` / `DEBIT5 168588.00` |
| `KLINE 9` (receipt, `FNCNUM 26140701`, `IVNUM RC260002570`) | credit | `ש'ח` / `CREDIT1 496997.42` | `null` / `0` |

`alignAccount10149PaymentAmountsForInvoice` looks for the USD side on the receipt
row, which structurally never has it, so it falls through unchanged
(`alignmentChanged: false`) and `resolvePaymentImportAmounts` rejects on the
currency guard.

### Why the invoice ratio cannot rescue it today

`resolvePaymentImportAmounts` and `resolveVirtualAmounts` both derive FX from
`invoice.amount / invoice.customer_amount`. For these invoices both columns hold
`168588` USD, so the ratio is `1` and `isInvalidInvoiceRatio` / the fallback
branch kick in.

Cause is the invoice field mapping (verified in `ConnectorFieldMapping`,
account 10149, `import_type = 'Invoice'`):

```
TOTPRICE  -> invoice_amount   (customer amount, USD)
TOTPRICE2 -> base_amount      (equals TOTPRICE for these rows — ratio lost)
```

`CINVOICES` also exposes `IDG_SUM1` = `496997.42` (ILS) and `IDG_SUM2` =
`168588.00` (USD) — confirmed present in `discovered_headers` for the Invoice
import type only (absent on Payment). That is the correct dual-currency pair.

`DEBIT5 / DEBIT1 = 168588 / 496997.42 = 0.339254`; applying it to the receipt's
`CREDIT1` returns `168588.00` USD exactly, so full settlements convert to the
cent. The two outliers seen in logs (1.50x, 0.50x) are genuine partial payments.

### Existing state to correct

78 ILS-on-USD payments for customer 4114 (2026-05-15 → 2026-08-16) are already
stored. They entered via the deferred path, where
`resolveDeferredPaymentAmounts` skips the currency guard and copies
`customer_amount` into `amount`. Both columns therefore hold the ILS figure
(e.g. payment `197685`: `496997.4` against a `168588` USD invoice), so invoice
recalc has been fed ILS figures ~3x too large.

## Approach

1. **Restore the invoice FX ratio (mapping change, no code).**
   Repoint **only** `base_amount`: `TOTPRICE2 -> base_amount` becomes
   `IDG_SUM1 -> base_amount`. Leave `TOTPRICE -> invoice_amount` as-is — it
   already yields the correct customer amount, so `IDG_SUM2` is not needed and
   `invoice_amount` is never put at risk.

   **Why not also map `IDG_SUM2 -> invoice_amount`:** customer 4036 (account
   10149) has 2,035 ILS invoices, all at ratio exactly `1.0000`. If Priority
   leaves the second-currency slot `IDG_SUM2` at `0`/`null` on ILS-only
   invoices, mapping it to `invoice_amount` would zero all of them. Restricting
   the change to `base_amount` avoids this: for an ILS customer `IDG_SUM1`
   should equal `TOTPRICE`, keeping the ratio at 1 and behavior unchanged.

   **Blocking verification:** pull a customer-4036 invoice (e.g. `SI260024553`,
   customer_amount `4989.44` ILS) from `CINVOICES` and read `IDG_SUM1`.
   `4989.44` → safe as a blanket mapping. `0`/`null`/a converted figure → scope
   the base amount through the account extension transform instead of the
   account-wide mapping.

   Confirm `IDG_SUM1` reaches the Invoice `$select` (it is in
   `discovered_headers`, so no `prioritySelectFields` change expected — verify).

2. **Convert the ILS receipt using the invoice ratio.**
   In `alignAccount10149PaymentAmountsForInvoice`, add a branch for when neither
   `CODE` nor `CODE5` matches the invoice currency but the row currency matches
   the invoice's **base** currency: set `amount = CREDIT1/DEBIT1` (ILS) and
   `customer_amount = ils / ratio` (USD). This needs the invoice base amount
   passed into `ExtensionAlignPaymentAmountsInput` (currently only
   `invoiceCustomerCurrency` is supplied) — extend the input type and the call
   site in `importPaymentService`, which already has `invoiceAmountContext`.

3. **Close the residual with a virtual payment.**
   `applyReconciledVirtualCloses` already does exactly this: it computes
   `remaining = customer_net_amount − realCustomerPaid`, applies
   `invoice_paid_tolerance`, and upserts or deletes one
   `payment_method = "virtual"` row per invoice keyed on
   `buildVirtualPaymentReference`. No new mechanism is required.

   **Ordering is critical:** step 2 must land before the virtual close runs.
   If the ILS receipt is still rejected, `realCustomerPaid` is `0` and the
   virtual payment silently covers 100% of the invoice, hiding the real receipt
   instead of the FX residual. Confirm `afterPaymentLinked` sequencing enforces
   this.

   `resolveVirtualAmounts` shares the ratio dependency and is fixed by step 1.

4. **Backfill the 78 stored rows.** Recompute `customer_amount` (USD) and
   `amount` (ILS) from the invoice ratio, then recalc the affected invoices via
   `recalculateInvoicesFromLinkedPayments` so outstanding balances correct.

## Codebase scan

**Required**
- `ConnectorFieldMapping` rows for account 10149, `import_type = 'Invoice'` — step 1.
- `packages/billing-connector/src/extensions/account_10149/index.ts` —
  `alignAccount10149PaymentAmountsForInvoice` branch (step 2).
- `packages/billing-connector/src/extensions/types.ts` —
  `ExtensionAlignPaymentAmountsInput` gains the invoice base amount.
- `packages/billing-connector/src/import/importPaymentService.ts` — pass the base
  amount at the `alignPaymentAmountsForInvoice` call site.
- `packages/billing-connector/src/payment/alignPaymentToInvoiceCurrency.ts` —
  **new** shared helper: `deriveInvoiceFxRatio` (moved out of the account_10149
  extension to avoid duplication) and `alignPaymentToInvoiceCurrency`, which
  returns corrected amounts or `null` when no change is warranted.
- `packages/billing-connector/src/import/applyMaturedDeferredPayments.ts` —
  convert at link time. Rows needing conversion take a per-row `update` (grouped
  `updateMany` cannot carry row-specific amounts); the rest keep the existing
  batched path. Extension resolution moved before the link loop so
  `normalizePaymentCurrency` is available.
- `scripts/datafixes/realign-payments-to-invoice-currency.ts` — **new**
  `--dry-run` / `--fix` backfill reusing the same helper, then
  `recalculateInvoicesFromLinkedPayments`.

**Optional / out of scope unless requested**
- `resolveDeferredPaymentAmounts` currency-guard gap — the route by which the 78
  bad rows entered. Worth closing so this cannot silently recur, but it is a
  behavior change affecting all accounts.
- Reducing per-row log volume (one `console.warn` block per failure).

**No change needed**
- `prioritySelectFields.ts` — `CODE5`/`CREDIT5`/`DEBIT5`/`CURDATE` are already in
  `PAYMENT_ALWAYS_SELECT_SOURCES`; the fields are requested, the receipt row
  simply has no USD side.
- Payment mapping `PAY_AMOUNT -> amount` and `PAY_AMOUNT -> customer_amount` is
  by design, not a misconfiguration. `PAY_AMOUNT` is a connector **synthetic**
  (`connectorPaymentSynthetics.ts`): absent from the raw ERP response (hence not
  in Postman), but present in `discovered_headers` and the mapping picker because
  `applyPaymentSyntheticsToRecords` runs in `PriorityClient` /
  `PriorityProviderClient` before discovery samples the rows.
  `pickNonZeroAmount` reads `CREDIT1` → `DEBIT1` → `CREDIT` → `DEBIT`, i.e. only
  the primary `CODE` side, never `CREDIT5`/`DEBIT5`.
  It structurally cannot carry the USD side, which is why the split belongs in
  `alignPaymentAmountsForInvoice` (step 2) rather than in the mapping.
- `reconciledVirtualClose.ts` — mechanism is sufficient once the ratio is restored.
- `resolvePaymentImportAmounts.ts` — no change. Once step 2 supplies a row whose
  `customer_currency` normalizes to the invoice currency, the guard passes and
  `row.amount` is finite, so the existing early-return yields the correct ILS
  base / USD customer amounts.
- `resolveTablePullShape.ts` — pagination/columns unaffected.

## Risks

- Changing `base_amount` affects every invoice on account 10149, not just
  customer 4114. Mitigated by leaving `invoice_amount` untouched, but still
  gated on the customer-4036 `IDG_SUM1` check above.
- Step 3's ordering hazard above is the main correctness risk.
- Backfill must be idempotent and must not disturb existing `virtual` rows.

## Testing strategy

Tests only if explicitly requested. Candidate units, mapped to requirements:

- ILS receipt + USD invoice with a valid ratio → converts to exact USD
  (`SI260009586`: 496997.42 ILS → 168588.00 USD).
- Partial ILS receipt → proportional USD, invoice left open beyond tolerance.
- Ratio unavailable (`amount === customer_amount`) → still fails with a clear key.
- ILS payment + ILS invoice at ratio 1 (customer 4036 shape) → unchanged from
  today; no regression for the ~10,700 ILS-on-ILS payments.
- Virtual close after a converted receipt → covers only the residual, never the
  full invoice.
- Existing `resolvePaymentImportAmounts.test.ts` cases keep passing.

## How to test

1. Set the account 10149 Invoice mapping to `IDG_SUM1 -> base_amount` (leaving
   `TOTPRICE -> invoice_amount`); run an invoice sync. Confirm `Invoice.amount`
   (ILS) now differs from `Invoice.customer_amount` (USD) for `SI260009586`, and
   that customer 4036's invoices still show `amount = customer_amount`
   (e.g. `SI260024553` = `4989.44` on both).
2. Run a payment sync. The `paymentCurrencyMismatch` warnings for account 10149
   should disappear from the API log.
3. Check payment reference `181|26140701|9`: `customer_amount` ≈ `168588.00` USD,
   `amount` ≈ `496997.42` ILS, `customer_currency` = `USD`.
4. Open invoice `SI260009586` in the app — it should show as fully paid with no
   ~3x over-credit, and at most one `virtual` payment covering a residual within
   `invoice_paid_tolerance`.
