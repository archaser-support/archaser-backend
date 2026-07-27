---
name: payment-import-derive-amount
overview: Make base-currency payment amount optional on import; derive it from customer_amount using the linked invoice's embedded FX ratio when absent.
source: grill-me session (Jul 2026)
clickup_task_url: https://app.clickup.com/t/869dye7mx
isProject: false
---

## Problem Statement

Teams importing payments from ERP exports typically receive amounts in the customer's invoice currency (`customer_amount`) but not always in the account base currency (`amount`). Today the payment import API requires both amount fields on every row, which forces importers to pre-calculate base amounts outside Archaser or leave rows failing validation.

This is inconsistent with invoice import, which already treats customer-currency amounts as the primary input and derives base-currency equivalents using the ratio embedded in the invoice (`amount / customer_amount`). Payment import should follow the same model: trust the customer-currency payment amount and derive the base amount from the related invoice's rate.

There is also internal inconsistency: the UI field catalog already treats base `amount` as optional, while the API validation layer still requires it along with other fields that the catalog does not mark required.

## Solution

Relax payment import so base `amount` is optional. When omitted, Archaser looks up the payment's linked invoice and derives:

```
base amount = customer_amount × (invoice.amount / invoice.customer_amount)
```

This uses the invoice's **embedded rate** (the same ratio semantics invoice import uses for `total_paid` derivation), not the live currency-rates table.

When a row supplies both `amount` and `customer_amount`, the explicit base `amount` is kept (backward compatible). Validation fails clearly when derivation is impossible (invalid invoice ratio, currency mismatch, zero customer amount) rather than silently creating zero-value payments.

All import entry points—manual file import, the payment import API, and the billing connector—share one resolution module so behavior is identical everywhere.

## User Stories

1. As an accounts receivable clerk, I want to import payment files with only customer-currency amounts, so that I do not need to calculate base-currency equivalents in Excel before upload.

2. As an accounts receivable clerk, I want Archaser to derive the base payment amount from the invoice I reference, so that payment amounts stay consistent with how the invoice was originally imported.

3. As an accounts receivable clerk, I want to continue mapping an explicit base `amount` column when my ERP provides it, so that existing import templates keep working without change.

4. As an accounts receivable clerk, I want import to fail with a clear error when the linked invoice has no usable amount ratio, so that I fix invoice data instead of posting incorrect zero payments.

5. As an accounts receivable clerk, I want import to fail when my payment currency does not match the invoice currency, so that cross-currency mis-posting is caught at import time.

6. As an accounts receivable clerk, I want import to reject zero customer amounts, so that empty payment rows do not create meaningless records.

7. As an accounts receivable clerk, I want to import refund or reversal payments with negative customer amounts, so that credit adjustments flow through the same import path as regular payments.

8. As an accounts receivable clerk, I must still supply payment date, customer currency, customer amount, customer number, invoice number, and reference on every row, so that required payment identity and timing fields are never guessed.

9. As a billing connector operator, I want ERP-synced payment rows to derive base amounts the same way as file import, so that connector and manual import behave identically.

10. As an admin reviewing import job results, I want derived base amounts persisted in processed row data, so that I can audit what Archaser calculated versus what the file contained.

11. As a developer maintaining import validation, I want a single shared resolution function for derive-and-validate logic, so that API, connector, and service layers cannot drift.

12. As a developer writing tests, I want to test payment amount resolution as pure input/output behavior against invoice context, so that edge cases are covered without standing up the full import pipeline.

13. As a product owner, I want the import field catalog, API validation, and field-mapping documentation to agree on which payment fields are required, so that users are not surprised by mismatched UI and server rules.

14. As an accounts receivable clerk importing a partial payment, I want the derived base amount to scale proportionally with my customer-currency payment, so that a 50% customer-currency payment produces the correct 50% base-currency equivalent.

15. As an accounts receivable clerk working with dual-currency invoices, I want derivation to use each invoice's own embedded rate, so that payments on different invoices with different rates are handled correctly per invoice.

16. As a support engineer, I want validation error messages to identify whether failure was due to missing ratio, currency mismatch, or zero amount, so that I can guide customers to the right fix quickly.

17. As an accounts receivable clerk, I want duplicate payments (same account, customer, reference) to continue being skipped idempotently, so that re-importing a file does not create duplicates regardless of whether base amount was derived or explicit.

18. As a user with business-unit-scoped access, I want amount derivation and validation to run only after my customer and invoice access checks pass, so that security rules are unchanged by this feature.

19. As an importer using optional `payment_method`, I want that field to remain optional, so that minimal payment files are still accepted when method is unknown.

20. As a finance lead, I want this feature to avoid schema migrations, so that rollout is low risk and backward compatible with existing `InvoicePayment` records.

## Implementation Decisions

### Locked product decisions (from grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Required row fields | `customer_number`, `invoice_number`, `reference`, `customer_amount`, `customer_currency`, `payment_date` |
| D2 | `payment_date` | Required — no defaulting |
| D3 | Both amounts provided | Keep explicit base `amount`; derive only when missing |
| D4 | `customer_currency` | Required on every row — no default from invoice |
| D5 | Invalid invoice ratio | Fail row (null/zero `invoice.amount` or `invoice.customer_amount`) |
| D6 | Scope | All import paths: file UI, payment import API, billing connector, normalization |
| D7 | Currency mismatch | Fail when row `customer_currency` ≠ `invoice.customer_currency` |
| D8 | Zero `customer_amount` | Fail validation |
| D9 | Negative `customer_amount` | Allow; apply same ratio formula (refunds/credits) |

### Primary seam: `resolvePaymentImportAmounts`

Introduce one pure module (working name: `resolvePaymentImportAmounts`) that accepts:

- Import row fields: optional base `amount`, required `customer_amount`, required `customer_currency`
- Invoice context: `amount`, `customer_amount`, `customer_currency` from the linked invoice

It returns either:

- **Success:** resolved `{ amount, customer_amount, customer_currency }` ready for `createInvoicePayment`, or
- **Failure:** a stable validation error key (e.g. ratio unavailable, currency mismatch, zero customer amount)

All callers—`ImportPaymentService`, the payment import API validation layer, billing connector payment mapping—invoke this module after invoice lookup and before payment creation. This is the **single test seam** for business logic; callers only need thin integration tests.

### Derivation formula

When base `amount` is absent or empty after normalization:

```
amount = customer_amount × (invoice.amount / invoice.customer_amount)
```

Same semantics as invoice import's `calculateTotalPaidFromRatio` (including negative values). Do not use the `CurrencyRate` table for this feature.

When base `amount` is present (finite number), use it unchanged.

### Normalization changes

`normalizePaymentInput` must treat missing/blank base `amount` as `undefined`, not `NaN` or `0`. Connector payment mapping must stop falling back to `customer_amount` or `0` for base amount before resolution runs—that bypasses ratio logic and can mask errors.

### ImportPaymentService changes

Expand invoice lookup to select `amount`, `customer_amount`, and `customer_currency` (not just invoice id). After customer/invoice/reference checks and before idempotent skip/create:

1. Call `resolvePaymentImportAmounts`
2. On failure, return row error with validation key
3. On success, pass resolved amounts to `PaymentService.createInvoicePayment`

Idempotent skip-by-reference behavior is unchanged.

### API validation (Joi)

Update payment import schema:

- `amount`: optional (number)
- `customer_amount`: required (number, non-zero — custom validator)
- `customer_currency`: required (string)
- `payment_date`: required (ISO date)
- Existing required fields unchanged

Joi covers shape; ratio/currency business rules run in `resolvePaymentImportAmounts` where invoice context exists. Avoid duplicating ratio logic in Joi.

### Field catalog and UI alignment

Update `PAYMENT_CATALOG` required fields to match D1/D2/D4: add `customer_amount`, `customer_currency`, `payment_date`; keep `amount` optional. Align file-import UI required-field indicators with the catalog (shared constant preferred over duplicating lists).

Update import field-mapping Excel generator: mark base `amount` as optional; document derivation rule in field description.

### Billing connector parity

Connector payment batch import must resolve amounts through the same module after invoice is identified—remove pre-resolution `amount ?? customer_amount ?? 0` shortcut.

### i18n

Add validation message keys for new failure cases (ratio unavailable, currency mismatch, zero customer amount). **Requires explicit user approval** before editing locale files per project rules.

### No schema changes

`InvoicePayment` already stores both `amount` and `customer_amount`. No Prisma migration required.

### Type shape for resolution (decision-rich)

```typescript
type PaymentImportResolutionInput = {
  amount?: number;
  customer_amount: number;
  customer_currency: string;
};

type InvoiceAmountContext = {
  amount: number | null;
  customer_amount: number | null;
  customer_currency: string | null;
};

type PaymentImportResolutionResult =
  | { ok: true; amount: number; customer_amount: number; customer_currency: string }
  | { ok: false; errorKey: string }; // i18n key, e.g. import.validation.paymentAmountDerivationFailed
```

## Testing Decisions

### What makes a good test

Test **observable behavior** of `resolvePaymentImportAmounts`: given row + invoice context, assert resolved amounts or error keys. Do not assert internal call order of import services or Joi details unless testing integration boundaries.

### Primary test target (single seam)

**`resolvePaymentImportAmounts`** — unit tests covering:

| Scenario | Expected outcome |
|----------|------------------|
| Missing base amount, valid dual-currency invoice | Derived base amount matches ratio (e.g. customer 500, invoice 1000/1200 → base 416.67…) |
| Explicit base amount provided | Explicit value kept |
| Same-currency invoice (amount === customer_amount) | Derived base equals customer_amount |
| Negative customer_amount | Derived base negative, same ratio |
| Invoice amount or customer_amount null/zero | Failure: ratio unavailable |
| Row currency ≠ invoice currency | Failure: currency mismatch |
| customer_amount === 0 | Failure: zero amount |
| Missing base amount treated as undefined after normalization | Derivation runs (not treated as 0) |

Prior art: `normalizeInvoiceImportInput` unit tests (field mapping and precedence), `ImportPaymentService` unit tests (skip/create integration with mocked payment service).

### Secondary (thin) integration tests

Extend `ImportPaymentService` tests with 2–3 cases proving the service calls resolution and passes resolved `amount` to `createInvoicePayment`, or returns failure without calling create. Mock invoice lookup to return amount context. Keep these minimal—the seam tests carry the edge-case weight.

### Out of test scope for this PRD

- End-to-end file upload UI tests
- Full API handler HTTP tests (unless existing payment import API test file already exists and is cheap to extend)
- Currency rate table behavior (explicitly out of product scope)

## Out of Scope

- Defaulting `customer_currency` from invoice when omitted
- Defaulting `payment_date` when omitted
- Using live `CurrencyRate` table as fallback when invoice ratio is missing
- Validating explicit base amount against derived value (tolerance check)
- UI preview of derived amount before submit (nice follow-up)
- Changes to manual payment entry outside import flows
- Changes to invoice import derivation logic (only parity reference)
- Database schema migrations
- Locale file edits without explicit user approval (keys may be stubbed with English defaults in code until approved)

## Further Notes

### Testing seam recommendation

One module (`resolvePaymentImportAmounts`) is the intended test seam. Confirm this matches your expectations before `/to-issues` breakdown; integration tests stay thin.

### Current inconsistency to fix

UI catalog already marks only `customer_number`, `invoice_number`, and `reference` as required, while API requires `amount`, `customer_amount`, `customer_currency`, and `payment_date`. This PRD locks the **union** of business-required fields per grill-me decisions.

### Relationship to invoice import

Invoice import treats `customer_amount` (`invoice_amount` alias) as optional and `amount` (`base_amount`) as required, deriving `total_paid` from `customer_total_paid` via the same ratio. Payment import inverts the emphasis: `customer_amount` is required, base `amount` is optional and derived—consistent philosophy (customer currency is source of truth; base is computed from invoice context).

### Suggested `/to-issues` vertical slices

1. **Core:** `resolvePaymentImportAmounts` + unit tests
2. **Import pipeline:** `ImportPaymentService`, API Joi, `normalizePaymentInput`
3. **Connector + catalog:** billing connector mapping, field catalog, Excel generator
4. **i18n + UI alignment:** validation keys (with approval), PaymentProcessor required-field sync

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Payment import: derive base amount from invoice ratio](https://app.clickup.com/t/869dye7mx)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Payment import derive amount — core resolver & file import pipeline | [869dye81h](https://app.clickup.com/t/869dye81h) | — | 1–4, 7, 10–12, 14–17 |
| 2 | Payment import derive amount — connector & field catalog parity | [869dye82h](https://app.clickup.com/t/869dye82h) | 1 | 9, 13, 19 |
| 3 | Payment import derive amount — i18n & file-import UI alignment | [869dye841](https://app.clickup.com/t/869dye841) | 1 | 8, 13, 16 |

**Assignee / status:** Nilotpal Bose; Selected for Development
