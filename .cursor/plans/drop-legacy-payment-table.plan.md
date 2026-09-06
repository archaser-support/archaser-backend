# Drop legacy `Payment` table

**Status:** Implemented (code); run deploy script on staging before prod  
**Repos:** Backend (schema, reports, checkpoint, deploy script) + Frontend (types, generic fields, report UI, i18n)

## Summary

Live AR payments already persist to **`InvoicePayment`**. The Prisma **`Payment`** model/table is legacy and write-dead in production. Import/ERP entity type **`"Payment"`** stays — it continues to write **`InvoicePayment`**.

This work drops table `"Payment"`, removes report/generic-field/checkpoint/type references, migrates or deletes saved report configs that still name table `Payment`, and cleans translations so Report Builder shows **“Payments”** for `InvoicePayment`.

## Decision log (grill)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Removal scope | Drop `Payment` table + remove all app references; keep import type `"Payment"` → `InvoicePayment` |
| D2 | Saved reports | Rewrite to `InvoicePayment` when every field/join maps 1:1; else delete report |
| D3 | Leftover rows | Log `COUNT(*)`, then drop (no archive) |
| D4 | Generic fields `payment` | Remove entirely; do **not** add generics to `InvoicePayment` |
| D5 | Report context `payments` | Remove entirely; keep `dashboard_payments` + free-form `InvoicePayment` |
| D6 | Old checkpoint `payments` | Ignore on restore; log skip count; restore `invoicePayments` only |
| D7 | Rewrite strictness | All-or-nothing 1:1 map; otherwise delete whole report |
| D8 | Translations | Remove obsolete keys **and** broader rename to reduce Payment vs InvoicePayment confusion (EN/HE allowed) |
| D9 | Report Builder label | Display **“Payments”** for technical table `InvoicePayment` |
| D10 | Deploy packaging | One ordered script + `--dry-run`; real run transactional where possible (no `prisma migrate dev`) |
| D11 | Tests | Rewrite `Payment` scenarios to `InvoicePayment` where useful; delete the rest |
| D12 | Quarantine scripts | Update/delete so nothing in-repo touches Prisma `Payment` |
| D13 | Next step | Write this plan; stop grilling |

## Explicit keep list (do not remove)

- Import type / ERP entity string `"Payment"`
- `POST /api/import/payment`, Nest `ImportService` leaf `payment`, body key `payments`
- Billing-connector entity order / enabled entities / Priority `TOTARPAY` paths for `"Payment"`
- Import UI + `locales/*/import.json` payment import copy
- Notification filter type `"payment"` / “Payment Received” (business events, not the table)
- `dashboard_payments` context → `InvoicePayment`
- MUI `Payment` icons, portal payment menu ids, “payment term” credit fields

## Explicit remove list

- Prisma model `Payment` + `Account` / `Customer` / `User` relations
- DB table `"Payment"` (after data cleanup script)
- Report metadata table `Payment`, `MODEL_NAME_MAP.Payment`, context `payments`, Payment relationships (incl. stale `InvoicePayment → Payment`)
- Generic entity `"payment"` (FE + Nest connectors + account `generic_field_config.payment`)
- Checkpoint snapshot key / client for legacy `payments` (`Prisma.ModelName.Payment`)
- Frontend `types/db.ts` `Payment` type + relations (via regenerate)
- Report UI maps that treat table key `Payment` as a selectable table
- Purge/quarantine/test references to Prisma `payment` / `"Payment"` table

---

## Report rewrite mapping (D2 / D7)

**1:1 field map (Payment → InvoicePayment):**  
`id`, `amount`, `payment_date`, `payment_method`, `reference`, `created_at`, `customer_id`, `account_id`, `customer_amount`, `customer_currency`, `created_by`, `modified_by`

**1:1 join map:**  
`Payment → Customer` becomes `InvoicePayment → Customer`  
`Payment → Account` (if any) becomes `InvoicePayment → Account`

**Not mappable (any use → delete whole report):**  
`generic_text1/2`, `generic_number1/2`, `generic_date1/2`, joins to/from table `Payment` that are not in the map above, fake metadata-only fields that do not exist on `InvoicePayment`, context `"payments"` (delete or clear context per D5)

**Also rewrite:** string `"Payment"` → `"InvoicePayment"` in `report_config` `tables[]`, field `table` properties, sort/filter/formula references.

System reports already on `InvoicePayment` (e.g. `create-dashboard-payments-reports.sql`) — **no change**.

---

## Implementation phases

### Phase 1 — Deploy script (backend)

Add something like:

`scripts/database/drop-legacy-payment-table.ts` (or `.cjs`) with `--dry-run`.

Ordered steps in one transaction where possible:

1. Find `Report` rows whose `report_config` JSON references table `"Payment"` (and/or `context = 'payments'`).
2. For each: if every field/join maps 1:1 → rewrite to `InvoicePayment` (and clear `context` if it was `payments`); else **delete** the report (and dependent user-default / share rows as required by FKs).
3. Strip `generic_field_config -> 'payment'` from all `Account` rows (JSONB `-` operator or rewrite).
4. `SELECT COUNT(*) FROM "Payment"` → log.
5. `DROP TABLE IF EXISTS "Payment" CASCADE;` (or without CASCADE if FKs only inbound from Payment).

Dry-run prints IDs/names/actions without writing.

Companion SQL optional: `prisma/migrations/YYYYMMDD_drop_legacy_payment_table.sql` documenting the DDL for ops who apply SQL-only; prefer the TS script as source of truth for report/config rewrite.

**Do not** run `npx prisma migrate dev` or `db push --force-reset`.

### Phase 2 — Prisma schema (backend)

- Remove `model Payment`.
- Remove `Payment` / `Payment_Payment_*` relations from `Account`, `Customer`, `User`.
- `npx prisma generate` (local).
- Regenerate frontend DB types: `npm run generate:db-types` in frontend (or existing generate script).

### Phase 3 — Reports package (backend)

| File | Change |
|------|--------|
| `reports/src/reports/report-metadata.ts` | Remove `Payment` table block; set `InvoicePayment` label to **Payments** |
| `reports/src/reports/report.constants.ts` | Remove `Payment` from `MODEL_NAME_MAP`, `CONTEXT_PRIMARY_TABLE.payments`, `ENTITY_LIST_REPORT_CONTEXTS`, `TABLE_RELATIONSHIPS` Payment entries; remove `InvoicePayment.Payment` link |
| `reports/src/reports/report-relationships.ts` | Remove Customer↔Payment and InvoicePayment→Payment edges |
| `reports/src/reports/report-scope.util.ts` | Remove `primaryTable === "Payment"` branches |
| `reports/src/reports/report-virtual-fields.util.ts` | Remove `Payment` entry |
| Rebuild `reports/dist` if that is how Nest consumes the package | Match existing workspace practice |

### Phase 4 — Checkpoint + Nest generics (backend)

| File | Change |
|------|--------|
| `api/src/customers/customer-checkpoint.service.ts` | Remove `payments` table entry; on restore, if payload has `payments`, log skip count and continue (D6); stop counting `payments` in summary if removed |
| `connectors/src/accounts/accounts-nested.service.ts` | Remove `"payment"` from `GENERIC_ENTITIES` + types |
| Any OpenAPI/account DTO that types `generic_field_config.payment` | Drop `payment` key |

### Phase 5 — Scripts / tests / quarantine (backend)

| File | Change |
|------|--------|
| `scripts/testing/test-report-builder.ts` | Rewrite Payment cases → InvoicePayment where valid; delete rest (D11) |
| `scripts/database/purge-test-accounts-*.sql` | Remove `"Payment"` deletes (table gone) |
| `scripts/_quarantine/**` touching `payment` / `PaymentService` | Fix to `invoicePayment` or delete dead files (D12) |
| Report unit tests that assert Payment table metadata | Update or remove |

### Phase 6 — Frontend cleanup

| File | Change |
|------|--------|
| `utils/genericFieldUtils.ts` | Remove `"payment"` from `GENERIC_ENTITY_KEYS` + defaults |
| `app/.../settings/GenericFieldsList.tsx` | Remove payment entity row/label |
| `components/reports/{FilterBuilder,DragDropFieldSelector,FormulaColumnEditor}.tsx` | Remove `Payment` table UI maps; keep `InvoicePayment` mapped to **Payments** label key |
| `shared/utils/viewColumnGenerator.tsx` | Remove `Payment: "payments"` (or only if unused) |
| `shared/services/customerCheckpointService.ts` | Remove `payments` count from types/UI if exposed |
| `types/db.ts` | Regenerate — no hand-edit preferred |
| `locales/en|he/generic_fields.json` | Remove `entity_payment` |
| `locales/en|he/reports.json` | Remove obsolete `tables.payments` if unused; set `tables.invoice_payments` (or successor key) label to **Payments** / HE equivalent (D8/D9) |
| Broader copy pass (D8) | Grep leftover “Invoice Payments” user-facing strings that mean the report table; align to “Payments” where not confusing with import |

### Phase 7 — Verify

- Backend: `npx tsc --noEmit` (api/reports as applicable), targeted report/checkpoint tests.
- Frontend: `npm run type-check`, generic-fields / report builder smoke.
- Staging: `--dry-run` then real script; confirm Report Builder has one Payments table (`InvoicePayment`); import payment still works; dashboard collected still works.

---

## Codebase scan

### Required

**Backend**

- `prisma/schema.prisma` — drop model + relations
- New deploy script (+ optional SQL migration file)
- `reports/src/reports/report-metadata.ts`
- `reports/src/reports/report.constants.ts`
- `reports/src/reports/report-relationships.ts`
- `reports/src/reports/report-scope.util.ts`
- `reports/src/reports/report-virtual-fields.util.ts`
- `api/src/customers/customer-checkpoint.service.ts`
- `connectors/src/accounts/accounts-nested.service.ts` (+ generated/dist if committed)
- `scripts/testing/test-report-builder.ts`
- `scripts/database/purge-test-accounts-part2-explicit-ids.sql` / `purge-test-accounts-by-name.sql`
- `scripts/_quarantine/testing/credit-reporting-sample-data/*` (Payment / PaymentService)
- `prisma/migrations/add_generic_fields.sql` — **historical**; do not rewrite history; new migration/script handles live DB

**Frontend**

- `utils/genericFieldUtils.ts`
- `app/[locale]/app/settings/GenericFieldsList.tsx`
- `components/reports/FilterBuilder.tsx`
- `components/reports/DragDropFieldSelector.tsx`
- `components/reports/FormulaColumnEditor.tsx`
- `shared/utils/viewColumnGenerator.tsx`
- `shared/services/customerCheckpointService.ts`
- `types/db.ts` (regenerate)
- `locales/en/generic_fields.json`, `locales/he/generic_fields.json`
- `locales/en/reports.json`, `locales/he/reports.json`
- `app/[locale]/app/reports/builder/page.tsx` — table combo maps mentioning `payment` / `"customer,payment"` if they assume report table Payment

### Optional / out of scope unless requested

- Rewriting historical plan/PRD docs that mention legacy `Payment`
- Adding generic columns to `InvoicePayment`
- Renaming import type `"Payment"` to `"InvoicePayment"` (explicitly rejected by D1)
- Changing notification / portal “payment” UX copy beyond report-table confusion (D8 scoped to Payment-table vs InvoicePayment labeling)
- Amplify typecheck fixes from unrelated session

### No change needed

- `packages/billing-connector/**` import path for entity `"Payment"` → `invoicePayment` writes
- `api/src/import/**` leaf payment routes
- `shared/constants/importEntityFields.ts` ImportType `Payment`
- `BillingIntegrationSettings` enabled entity `"Payment"`
- `scripts/database/create-dashboard-payments-reports.sql` (already `InvoicePayment`)
- `dashboard_payments` viewConfig / chart filters
- Credit as-of SQL on `"InvoicePayment"`
- `locales/*/import.json` payment import strings

---

## Testing strategy

| Requirement | Test unit | How |
|-------------|-----------|-----|
| Deploy script dry-run is safe | Manual / script self-test | Run `--dry-run` on staging DB; assert no writes |
| 1:1 report rewrite | Script unit or fixture JSON | Config with only mappable fields → tables become `InvoicePayment` |
| Non-mappable report deleted | Script unit or fixture | Config with `generic_text1` → deleted |
| Context `payments` cleared/removed | Script + report constants | No `CONTEXT_PRIMARY_TABLE.payments`; leftover context reports handled |
| Checkpoint restore ignores legacy `payments` | Unit on checkpoint service | Payload with both buckets → only `invoicePayments` restored; skip logged |
| Generic entity payment gone | Unit / type-check | `GENERIC_ENTITY_KEYS` / Nest `GENERIC_ENTITIES` length 3 |
| Prisma client has no `payment` | `prisma generate` + tsc | No `prisma.payment` references compile |
| Import type Payment still works | Existing billing-connector / import tests | Unchanged paths still green |
| Report builder Payment scenarios | `test-report-builder.ts` | Cases retargeted to InvoicePayment or removed |
| UI label “Payments” | Manual | Report Builder table list shows Payments once |

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Saved reports silently wrong | D7 all-or-nothing rewrite; dry-run lists deletes |
| Someone re-adds Payment model | Quarantine/purge cleaned; grep `prisma.payment` in CI optional follow-up |
| Confusion with import type `"Payment"` | Plan keep-list; comments in schema removal PR |
| Transaction too large | Script may batch report updates then DROP in same or follow-up txn; document in script header |

## Plan improvements noted

- Easy to miss: stale `InvoicePayment → Payment` relationship and `Payment.modified_at` in metadata (column never existed on model).
- Easy to miss: account JSONB `generic_field_config.payment` + FE defaults.
- Easy to miss: report builder page table-combination maps (`"customer,payment"`).
- Cross-cutting: translation edits explicitly approved (D8); no new styles; no `migrate dev`.

## Out of scope

- Data archive of `"Payment"` rows (D3)
- Product rename of import entity string
- New InvoicePayment generic fields
