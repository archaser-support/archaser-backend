# Account 10149 — recon close + virtual payment

## Goal

When a Priority AR receipt is reconciled (`FRECONNUM` + invoice link + `BAL=0`), close the invoice. If cash is short by more than 0.2, upsert an `InvoicePayment` with `payment_method = "virtual"` for the gap.

## Decisions (grilling)

| # | Decision |
|---|----------|
| D1–D2 | Close on reconciled receipt (`FRECONNUM` + `FNCIREF1` + `BAL=0`), not Helam-only |
| D3 | Virtual only for shortfall; no virtual if covered/over |
| D4 | Mark with `payment_method = "virtual"` |
| D5 | Ref `virtual\|{invoice_number}`; upsert |
| D6 | Remove Helam `isForcePaidClose` |
| D7 | Skip debit / invoice-side recon lines |
| D8 | Virtual counts in paid/collected totals |
| D9 | Virtual only if remaining > 0.2 |
| D10 | Virtual `payment_date` = receipt date |
| D11 | Connector invoice/payment dates = calendar date only |
| D12 | Delete virtual when gap gone, then recalc |

## Implementation

1. `account_10149` transform: drop debit payment rows; remove Helam force-close.
2. Core calls optional `afterPaymentLinked` after linked payments (incl. skips).
3. **All virtual-close / recon policy lives in the extension** (`reconciledVirtualClose.ts` + `afterAccount10149PaymentLinked`).
4. Date-only on payment normalize + `parseErpDateOnly` on write (core).
5. Update admin panel copy.

## Out of scope

- New `payment_type` column
- Excluding virtual from KPI sums
- App-wide date cleanup beyond connector import
