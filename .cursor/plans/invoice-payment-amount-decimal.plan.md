# InvoicePayment amounts: Real → Decimal(20, 4)

## Goal

Stop float32 (`real`) drift on payment amounts so recon virtual close and as-of open AR see the same leftover (fixes MEP false positives like SI260009653 / SI260030239).

## Decision

| # | Topic | Decision |
|---|-------|----------|
| D1 | Target type | `Decimal @db.Decimal(20, 4)` — matches invoice `limit_assessed_amount` / `capacity_gap_amount` |
| D2 | Scope (this delivery) | **Only** `InvoicePayment.amount` and `InvoicePayment.customer_amount` |
| D3 | Invoice nets | **Defer** — already Postgres `double precision` (not `real`). Full Invoice money → Decimal is a separate blast-radius PR |
| D4 | App math | Keep billing-connector internal math as `number`; coerce Prisma `Decimal` → `number` at read boundaries |
| D5 | Existing rows | `USING ROUND(column::numeric, 4)` — preserves stored float4 bits as numeric (e.g. `1635541.375`); re-run virtual close after migrate to rewrite virtuals |

## Codebase scan

### Required

| File | Why |
|------|-----|
| `prisma/schema.prisma` | `InvoicePayment.amount` / `customer_amount` → `Decimal @db.Decimal(20, 4)` |
| `prisma/migrations/20261008_invoice_payment_amount_decimal.sql` | `ALTER … TYPE NUMERIC(20,4)` |
| `packages/billing-connector/src/import/importPaymentService.ts` | Drop `sameRealAmount` / `Math.fround`; coerce reads |
| `packages/billing-connector/src/payment/virtualPaymentTrim.ts` | Sum / remaining from coerced numbers |
| `packages/billing-connector/src/invoice/linkDeferredPaymentAndRecalc.ts` | Payment sum `+=` |
| `packages/billing-connector/src/invoice/invoiceFuturePaymentCover.ts` | Payment sum |
| `packages/billing-connector/src/import/applyMaturedDeferredPayments.ts` | In-memory payment reads |
| `packages/billing-connector/src/payment/alignPaymentToInvoiceCurrency.ts` | `Number.isFinite` on amounts |
| `api/src/common/serialize-bigint.ts` (+ report/connector/sms copies if present) | JSON-serialize `Prisma.Decimal` |
| `frontend/types/db.ts` | Keep `number` on API wire, or document string if serializer changes |

### Optional / out of scope

| Item | Reason |
|------|--------|
| Invoice `amount` / `net_*` / `paid` / `outstanding_*` → Decimal | Already `float8`; large TS/FE surface — phase 2 |
| Bulk `UNNEST(...::float8[])` → `numeric[]` | Works with numeric columns via cast; optional cleanup |
| Automated tests | Only if explicitly requested |
| ERP re-import to restore intended `.4` vs stored `.375` | Data repair / re-sync, not schema |

### No change needed

| Item | Reason |
|------|--------|
| as-of SQL `SUM(ip.amount)` | Works on `numeric` |
| Virtual close write path (`createMany` numbers) | Prisma accepts number → Decimal |

## Implementation

1. Schema + committed SQL migration (no top-level `BEGIN`/`COMMIT`).
2. Shared coerce helper in billing-connector (or reuse existing `decimalToNumber` pattern).
3. Replace Real equality with exact numeric compare (string or `Decimal` equality at 4 dp).
4. Extend `serializeBigInt` → also stringify Decimal (fix nested payment JSON).
5. Local: `npx prisma db execute --file …` then `npx prisma generate` (not `migrate dev`).
6. How to test: re-diagnose SI260030239; refresh virtual on SI260009653; confirm leftover within ±0.2 and CTV cause clears / changes.

## Testing Strategy

| Requirement | How to verify |
|-------------|----------------|
| Columns are numeric(20,4) | `information_schema` / `\d InvoicePayment` |
| Virtual matches SQL SUM residue | Re-run `applyReconciledVirtualCloses` / trim on SI260009653; `SUM` open ≈ 0 |
| MEP false cause gone | `inspect-terms-breach-invoices.ts --invoice SI260030239 --diagnose` → not caused by closed SI260009653 (or flagged false if no other overdue) |
| Invoice API payments JSON | GET invoice with payments — amounts are numbers/strings, not `{}` |

## Follow-up (phase 2 — not this PR)

Migrate Invoice header money fields from `Float` / `float8` to `Decimal(20,4)` across billing, credit-insurance, reports, and frontend types.
