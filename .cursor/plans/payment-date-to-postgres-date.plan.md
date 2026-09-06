---
name: InvoicePayment payment_date to DATE
overview: Phase 1 only — migrate InvoicePayment.payment_date from timestamptz to Postgres DATE using UTC calendar-day cast. Aligns storage with parseErpDateOnly / report type date. No other date-column work.
todos:
  - id: sql-migration
    content: Add SQL migration ALTER InvoicePayment.payment_date TYPE DATE USING payment_date::date
    status: completed
  - id: prisma-schema
    content: Change InvoicePayment.payment_date to @db.Date in prisma/schema.prisma
    status: completed
  - id: smoke-verify
    content: Apply on staging; verify information_schema; smoke payment import + as-of AR payment_date comparisons
    status: completed
isProject: false
---

# Phase 1 — `InvoicePayment.payment_date` → Postgres `DATE`

**Status:** Ready for agent (plan only — not implemented)  
**Scope:** Single column migration + Prisma attribute. No FE/report metadata changes required.

## Decisions (grill-me)

| # | Decision |
|---|----------|
| D1 | Inventory freeze first; no drive-by date cleanup |
| D2 | Phase 1 = migrate `payment_date` only |
| D3 | Cast with `USING payment_date::date` (UTC calendar day) — matches `parseErpDateOnly` |
| D4 | Write this plan before code |

## Problem

- `InvoicePayment.payment_date` is `@db.Timestamptz(6)`.
- Product and connector treat it as a **calendar date**: `toErpDateOnly` / `parseErpDateOnly`, mapping transform `"date"`, report metadata already `type: "date"`.
- `Invoice.last_payment_date` is already `@db.Date` but is derived from `MAX(payment_date)` — storage types disagree.

## Out of scope

- `next_activity_date` (keep timestamptz — scheduling)
- Other `*_at` / audit timestamps
- FE formatter changes (already date-oriented for this field via report meta)
- Changing report metadata (already `type: "date"`)

## Implementation

### 1. SQL migration

New file under `prisma/migrations/` (same style as `20260902_customer_oldest_invoice_overdue_date_to_date.sql`):

```sql
-- Calendar-date semantics: payment_date is ERP/business day only (UTC cast).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/<file>.sql

ALTER TABLE "InvoicePayment"
  ALTER COLUMN "payment_date"
    TYPE DATE
    USING "payment_date"::date;
```

### 2. Prisma

```prisma
// InvoicePayment
payment_date  DateTime  @db.Date
```

Regenerate Prisma client per repo workflow after apply.

### 3. Code touchpoints (expect little/no logic change)

| Area | Why check |
|------|-----------|
| `packages/billing-connector/.../parseErpDateOnly` + `importPaymentService` | Already UTC midnight for `@db.Date` |
| `packages/billing-connector/.../normalizePaymentInput` | Already `YYYY-MM-DD` strings |
| `packages/credit-insurance-domain/.../asOfOpenAr.ts` | `payment_date < dayAfter` — still valid on DATE |
| Report export / `formatReportDate` | Metadata already `date` |

Do **not** change import or report paths unless smoke tests fail.

## Verify

1. Staging: run migration; confirm `information_schema` → `data_type = date` for `InvoicePayment.payment_date`.
2. Optional pre-check: `SELECT count(*) FROM "InvoicePayment" WHERE payment_date::time <> '00:00:00';` — expect ~0 if writes were date-only.
3. Smoke: connector payment import for one account; open an invoice payment report column; as-of / open-AR path that uses `payment_date`.

## Risks

- Rare non-midnight timestamptz rows: UTC `::date` may differ from a local-TZ interpretation (accepted per D3).
- Large table: `ALTER TYPE` may lock `InvoicePayment` briefly — run in a maintenance window on prod.

## Rollback

Re-cast to timestamptz only if required (data loss of time component is irreversible after DATE). Prefer forward-fix; do not roll back without an explicit ops decision.
