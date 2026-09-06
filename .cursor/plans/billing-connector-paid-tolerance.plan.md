# Billing connector — paid leftover tolerance (Sync Settings)

## Goal

Replace the hardcoded `0.20` leftover band for **Paid** with a required number on `BillingConnector`, edited under **Sync Settings**. Saving the field does not restamp invoices. Connector payment recalc, the nightly leftover closer, Helam virtual close, and as-of leftover for **Open** invoices read the stored value.

No code until this plan is approved.

## Grill decisions (locked)

| # | Topic | Decision |
|---|-------|----------|
| D1 / D4 | Who | Every invoice on an account that **has a `BillingConnector` row**. No invoice source flag. File leftovers on that account use the same number overnight. |
| D2 | On save | Do not restamp. Wait for next connector sync and/or nightly job. |
| D3 | Nightly leftover job | Uses the account’s stored number. Open → Paid can happen overnight. |
| D5 | Lowering the number | Never reopen Paid. Open → Paid only. |
| D6 | As-of | Setting applies to leftover math only while the invoice is still **Open**. **Paid** stays closed (existing `liveClosed` + last-payment-day rule). |
| D7 | Helam dummy close | Uses the same stored number (`remaining` vs ±T). |
| D8 | Empty / existing | Required. Column default `0.20`. Form cannot be blank. Existing rows stay `0.20` until edited. |
| D9 | Range | `0`–`10`, two decimal places. `0` = leftover must be exactly `0` to count as Paid. |
| D10 | Currency | One number per connector. Same leftover units as each invoice’s `customer_outstanding_debt` (customer currency). No FX. |
| D11 | Connector off | If the row exists, use its number even when Disabled / sync off. |
| D12 | File import mapping | Invoice file-import status mapping stays as today. Setting is applied on connector sync, payment-link recalc that already uses this helper, and the nightly leftover job. |

## Semantics (unchanged band, dynamic T)

Paid when `customer_outstanding_debt ∈ [-T, +T]` (`isWithinPaidTolerance`). Large negative leftover (credit notes) is not Paid.

`INVOICE_PAID_TOLERANCE = 0.2` remains the **default** when there is **no** connector row (nightly job, as-of, recalc fallback).

## Schema

On `BillingConnector` (one row per account, `account_id` unique):

```prisma
/// Leftover band for Paid (customer outstanding). Units = customer currency leftover.
invoice_paid_tolerance Float @default(0.2)
```

SQL (same style as `prisma/migrations/20260830_billing_connector_mep_breach_start_date.sql`):

```sql
BEGIN;
ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "invoice_paid_tolerance" DOUBLE PRECISION NOT NULL DEFAULT 0.2;
COMMIT;
```

Apply with `psql` / `npx prisma db push` only after approval — **not** `migrate dev` / `--force-reset`.

**Do not** lock this field after backfill starts (unlike start-date / skip-breach). Operators can edit it any time; D2 still applies.

## Backend

### Shared helper

Extend `packages/billing-connector/src/invoice/invoicePaidTolerance.ts`:

- Keep `INVOICE_PAID_TOLERANCE = 0.2` and `isWithinPaidTolerance(debt, tolerance?)`.
- Add `normalizeInvoicePaidTolerance(input): number` — required, finite, round to 2 decimals, `0`–`10` or throw 400.
- Add `resolveInvoicePaidTolerance(prisma, accountId): Promise<number>` — `findUnique` on `account_id`; if no row, return `0.2`; if row exists, use stored value (D11).

### Connector payment recalc (Open → Paid only)

`buildInvoicePaidUpdate` already never reopens Paid. Pass `tolerance` into `isWithinPaidTolerance` instead of the constant.

**Tension (D12 vs shared recalc):** `recalculateInvoiceFromLinkedPayments` is used by connector payment writes **and** `importArReplayService`. Recommended: resolve T from the connector row inside recalc (batch: one lookup per `account_id`, same pattern as `resolveForcePaidClose`). Accounts without a row keep `0.2`. File-import **invoice mapping** is unchanged; leftover without a payment event still waits for nightly (D2/D12).

### Nightly leftover closer

`packages/cron-jobs/src/closeZeroOutstandingDebtInvoices.ts`:

1. Load `BillingConnector` `{ account_id, invoice_paid_tolerance }`.
2. After outstanding recalc, load Due/Overdue with `account_id` + `customer_outstanding_debt`.
3. Close only when `isWithinPaidTolerance(debt, T)` where `T` is the row’s value, else `0.2`.
4. Do **not** use a single global `gte/lte ±0.2` filter.

### Helam (account 10149)

`reconciledVirtualClose.ts`: resolve T once per `accountId`. Dummy payment when `remaining > T || remaining < -T`. Recalc afterward still one-way Paid.

### As-of (D6)

`credit-insurance-domain` is a leaf; **do not** import `@archaser/billing-connector`.

- Add optional `tolerance` to `computeAsOfOpenAmount` (default `ASOF_OPEN_AMOUNT_TOLERANCE = 0.2`). Keep the existing **one-sided** residue rule `open <= T → 0` (do not switch as-of to ±T; that would change credit-note as-of).
- `computeAsOfOpenInvoiceLine` / `wasAsOfInvoiceOpenAt`: if `line.liveClosed` (Paid), keep today’s close-from-last-payment behavior — **do not** reopen via leftover vs T.
- If still Open, use account T. Resolver: same pattern as `resolveMepBreachStartDate.ts` (`findUnique` on `BillingConnector`, short TTL cache, no row → `0.2`).
- `reports/src/credit-insurance/domain/asOfOpenAr.ts` is a fork — keep signatures in sync if that copy is still compiled (file may be ignored locally; dist still exports `computeAsOfOpenAmount`).

## API (Nest)

Both `api/src/billing-connector/billing-connector.service.ts` and `connectors/src/accounts/accounts-nested.service.ts` (public config + upsert):

- GET: include `invoice_paid_tolerance`.
- PUT: accept number; `undefined` = omit; reject blank/null; validate via `normalizeInvoicePaidTolerance`.
- Shared parse next to `billing-connector-backfill-options.ts` (or that file) so api + connectors stay aligned.

## Frontend

- `shared/services/billingConnectorService.ts` — config + upsert payload.
- `app/.../BillingIntegrationSettings.tsx` — **Sync Settings** number field (reuse existing `TextField` / `InputLabel` / Grid like schedule fields). Required, `0`–`10`, step `0.01`. Hardcoded English copy (sibling fields are not i18n). Tooltip `placement="bottom"`.
- `types/db.ts` — add column on `BillingConnector` if that type is kept in sync.

**Copy (proposed):** label `Paid leftover tolerance`. Helper: leftover in each invoice’s customer currency; Paid when leftover is within ± this amount (`0` = exact zero).

**Styling:** reuse existing Sync Settings controls. No new theme / `sx` blocks / translation files unless separately approved.

## Out of scope unless requested

- Reopening Paid when T is lowered (D5).
- Invoice `source` / connector-id column (D4).
- FX conversion (D10).
- File-import invoice status mapper using T (D12).
- Switching as-of residue to two-sided ±T.
- Translation files (EN/HE).
- New tests (rules: tests only when asked). `api/test/billing-connector.test.ts` fixtures will need the field if those tests are run.
- `helamOffsetClose.ts` force-Paid path (already force-close, not leftover band).

## Testing Strategy (map to decisions)

Do not add automated tests unless asked. Manual / later units:

| Requirement | How to verify |
|-------------|----------------|
| D8 / D9 | New connector GET shows `0.20`. PUT `0.5` ok; blank / `10.01` / `-1` 400. UI rejects empty. |
| D2 | Save `0.50` with leftover `0.35` Open → stays Open until sync or nightly. |
| D3 / D4 / D11 | Connector Disabled, leftover `0.35`, T=`0.50` → nightly marks Paid. Account with no connector row, leftover `0.35` → stays Open (still ±0.20). |
| D5 | Paid leftover `0.15`, lower T to `0.05` → stays Paid after sync and nightly. |
| D6 | Open leftover `0.15`, T=`0.05` → as-of still shows open. Same invoice Paid → as-of closed from last payment day. |
| D7 | Helam leftover `0.35`, T=`0.50` → no virtual payment. T=`0.20` → virtual as today. |
| D10 | Two customers, leftover `0.40` USD and `0.40` ILS, T=`0.50` → both eligible for Paid on nightly/sync. |
| D12 | File-import invoice leftover `0.35` with no payment-link recalc → Open until nightly. |

## Codebase scan

### Required

| File | Why |
|------|-----|
| `backend/prisma/schema.prisma` | Column on `BillingConnector`. |
| `backend/prisma/migrations/2026…_billing_connector_invoice_paid_tolerance.sql` | Safe `ADD COLUMN … DEFAULT 0.2`. |
| `packages/billing-connector/src/invoice/invoicePaidTolerance.ts` | Normalize + resolve + keep default `0.2`. |
| `packages/billing-connector/src/invoice/linkDeferredPaymentAndRecalc.ts` | Pass T into `isWithinPaidTolerance`. |
| `packages/billing-connector/src/invoice/linkDeferredPaymentAndRecalc.ts` batch path | One T per `account_id` (with force-paid lookup). |
| `packages/billing-connector/src/extensions/account_10149/reconciledVirtualClose.ts` | D7. |
| `packages/cron-jobs/src/closeZeroOutstandingDebtInvoices.ts` | Per-account T (D3/D4/D11). |
| `packages/credit-insurance-domain/src/credit-insurance/domain/asOfOpenAr.ts` | Parameterized residue; Paid still `liveClosed`. |
| `packages/credit-insurance-domain/src/credit-insurance/domain/resolveMepBreachStartDate.ts` (new sibling resolver) | Account T without importing billing-connector. |
| `api/src/billing-connector/billing-connector.service.ts` | GET/PUT public config. |
| `api/src/billing-connector/billing-connector-backfill-options.ts` (or new parse helper) | Shared validation. |
| `connectors/src/accounts/accounts-nested.service.ts` | Nest nested billing config parity. |
| `frontend/shared/services/billingConnectorService.ts` | Types + payload. |
| `frontend/.../BillingIntegrationSettings.tsx` | Sync Settings field. |
| `frontend/types/db.ts` | Prisma-shaped type. |

### Optional / out of scope unless requested

| File | Why |
|------|-----|
| `api/test/billing-connector.test.ts` | Fixtures omit new required-with-default field; update only if tests are requested. |
| `reports/src/credit-insurance/domain/asOfOpenAr.ts` | Duplicate of domain package; sync if still a live fork. |
| `packages/billing-connector/dist/**` | Build output; regenerate, do not hand-edit. |
| Translation JSON | Sync Settings copy is hardcoded English today. |
| `helamOffsetClose.ts` | Force-Paid, not leftover band. |
| File-import invoice mappers | D12. |

### No change needed

| File | Why |
|------|-----|
| `Invoice` model | D4: no source column. |
| `invoice-paid-tolerance-band.plan.md` | Historical ±0.2 band; this plan supersedes the constant for connector accounts only. |
| `packages/billing-connector/src/index.ts` exports | Re-export new helpers if callers need them; constant stays. |
| Credit dashboard grids / export mappers | They read invoice status / amounts, not this constant. |
| Permissions | Same billing-connector manage permission as other Sync Settings. |

## Plan improvements / risks

- **Shared recalc vs D12:** looking up T inside `recalculateInvoiceFromLinkedPayments` means AR replay / any payment-link on a connector account uses T immediately. Alternative (more plumbing, stricter D12): pass `paidTolerance` only from connector import. Recommended is lookup-by-row (matches D4/D11, less miss risk).
- **Nightly query:** do not keep `gte/lte ±0.2` or leftovers between `0.2` and T never close overnight.
- **As-of one-sided vs Paid two-sided:** keep as-of `open <= T`; only Paid status uses ±T. Document in the Sync Settings helper if needed.
- **Frontend `types/db.ts` already omits `mep_breach_start_date`** — do not drive-by fix; UI uses `BillingConnectorConfig`.
- **Two Nest billing services** (`api` + `connectors`) must stay in parity or GET from one path will drop the field on save.

## How to test (after implementation)

1. Admin → account → Billing Integration → Sync Settings: field shows `0.20`, cannot clear, `0.50` saves, GET returns `0.50`.
2. Open invoice leftover `0.35`: after save only, still Open; after nightly (or connector payment recalc), Paid.
3. Paid invoice leftover `0.15`: set T to `0.05`; stays Paid.
4. Account with no connector: leftover `0.35` still Open after nightly.
5. As-of: Open + leftover `0.15` + T `0.05` still open on report; Paid invoice not reopened on report.
