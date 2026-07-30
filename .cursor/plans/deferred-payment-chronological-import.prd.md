---
name: deferred-payment-chronological-import
overview: Import payments before invoices using deferred InvoicePayment rows, chronological replay for capacity gap and total_paid, and billing-connector maturity for future-dated payments.
source: grill-me session (Jul 2026)
clickup_task_url: null
isProject: false
---

# Deferred Payment & Chronological AR Import

## Problem Statement

Since invoice-level capacity gap assessment was introduced, **payment date relative to invoice date** materially affects correctness: `limit_assessed_amount` stamping depends on open AR at invoice open time, and payments reduce outstanding without changing the invoice snapshot basis. Today import behaves as if payments and invoices can be processed independently:

- Payment import **fails** when the referenced invoice does not exist yet.
- Invoice import trusts file `customer_total_paid` and may synthesize `InvoicePayment` rows with **today's date** instead of the real payment date.
- Limit assessment during invoice import uses row totals, not a **timeline** of which payments had occurred by each `invoice_date`.
- The billing connector ingests entities in **Customer → Contact → Invoice → Payment** order, which assumes payments always follow invoices.

Operations teams and ERP sync therefore produce incorrect capacity gap, outstanding balances, and terms-breach outstanding when payments arrive before invoices or when payment dates fall after the invoice open date within the same backfill batch.

## Solution

Introduce a unified AR import model across **manual file import**, **import APIs**, and the **billing connector**:

1. **Ingest payments first** as deferred `InvoicePayment` rows (`invoice_id` null, `invoice_number` required) when the invoice is not yet linkable.
2. **Ingest invoices** without trusting file paid columns when payment records exist.
3. **Replay chronologically** per customer: merge invoice-open events (`invoice_date`) and payment-apply events (`payment_date`), process in date order, stamp `limit_assessed_amount` using open AR with only payments whose `payment_date <= invoice_date`.
4. **Mature future deferred payments** on billing connector scheduled sync for connector accounts (`payment_date <= today`, matching invoice exists).
5. **Reverse billing connector entity order** to Customer → Payment → Invoice → Contact, with replay and maturity as orchestration steps inside each sync run.

Manual import keeps **separate Payment and Invoice tabs**; server orchestration (replay on invoice job completion, maturity on connector sync) replaces a combined upload wizard.

## User Stories

### Payment ingest & deferral

1. As an accounts receivable clerk, I want to import payments **before** invoices exist in Archaser, so that ERP backfill order does not block my payment file.

2. As an accounts receivable clerk, I want payment rows with no matching invoice to be **deferred** (not failed), so that a missing invoice does not reject the whole job.

3. As an accounts receivable clerk, I want deferred payment rows to show a distinct **deferred** result in import job output, so that I can distinguish waiting-for-invoice from errors and duplicates.

4. As an accounts receivable clerk, I want duplicate payments (same account, customer, reference) to continue being skipped idempotently, so that overlap re-imports do not create duplicates.

5. As an accounts receivable clerk, I want deferred payments to retain the real **payment_date** from my file, so that capacity gap and outstanding reflect when cash was received.

6. As an accounts receivable clerk, I want payment import to require customer number, invoice number, reference, customer amount, customer currency, and payment date on every row, so that identity and timing are never guessed.

7. As an accounts receivable clerk, I want optional base `amount` derivation from the linked invoice's embedded FX ratio when the invoice exists at ingest time, so that dual-currency payment files stay consistent with the payment-import-derive-amount feature.

8. As a user with business-unit-scoped access, I want deferral and linking to respect existing business-unit access checks, so that security boundaries are unchanged.

### Invoice ingest & total_paid

9. As an accounts receivable clerk, I want invoice `total_paid` to be calculated from **linked payment records** when payments exist, so that I do not maintain paid columns in both files.

10. As an accounts receivable clerk, I want file `customer_total_paid` / `total_paid` columns ignored when payment records exist for that invoice, so that payment data is the single source of truth.

11. As an accounts receivable clerk on an **Invoice-Based** balance account, I want the legacy path that synthesizes payments from file totals to remain when **no** payment records exist, so that existing templates keep working.

12. As an accounts receivable clerk, I want invoice import to continue sorting by invoice date then invoice number per customer, so that replay order is deterministic.

13. As an accounts receivable clerk, I want invoices imported after payments to pick up all deferred payments for matching invoice numbers, so that I do not re-upload the payment file.

### Chronological replay & capacity gap

14. As a credit insurance operations user, I want `limit_assessed_amount` stamped using open AR **as of each invoice_date**, counting only payments with `payment_date <= invoice_date`, so that a payment after invoice open does not retroactively reduce the stamp basis.

15. As a credit insurance operations user, I want payments applied on their **payment_date** during replay, so that outstanding and capacity gap change when cash is received, not when the file is uploaded.

16. As a credit insurance operations user, I want limit assessment to call effective approved limit **as of each invoice_date** (including top-ups), so that historical backfill matches policy timelines.

17. As a credit insurance operations user, I want invoice-level capacity gap contributions to update after each payment event in the timeline, so that dashboard and customer header totals stay consistent with invoice-summed gap rules.

18. As a credit insurance operations user, I want terms-breach flags (`ctv_payment_term`, reporting breach, etc.) stamped at invoice import as today, with **terms_breach_outstanding** driven by current outstanding on breach-flagged open invoices, so that payment dates affect exposure through outstanding reduction rather than replaying historical Due/Overdue/Paid status.

19. As a developer, I want one chronological replay module used by manual invoice import and the billing connector, so that behavior cannot drift between entry points.

### Manual import orchestration

20. As an accounts receivable clerk, I want to keep using **separate Payment and Invoice import tabs**, so that I am not forced into a new combined upload UI.

21. As an accounts receivable clerk, I want replay to run automatically when my **invoice import job completes**, so that deferred payments and new invoices are reconciled without a manual extra step.

22. As an accounts receivable clerk, I want guidance (or a soft warning) when importing invoices before payments for customers that have no deferred payments, so that I understand recommended import order.

23. As an admin reviewing import results, I want invoice job completion to report replay statistics (events applied, payments linked, customers affected), so that I can audit backfill outcomes.

### Billing connector

24. As a billing connector operator, I want each sync to ingest **Customer → Payment → Invoice → Contact**, so that payments are deferred before invoices are pulled.

25. As a billing connector operator, I want replay to run after Payment and Invoice ingest in every sync (scheduled, manual, backfill), so that incremental ERP pulls stay correct without a separate job.

26. As a billing connector operator, I want **matured deferred payments** applied at the end of each connector sync (`payment_date <= today`), so that future-dated ERP payments take effect on or soon after their payment date without a separate platform cron.

27. As a billing connector operator, I want maturity to run even when the ERP returns zero new rows, so that calendar time passing still applies waiting payments.

28. As a billing connector operator, I want contact sync to remain **last** (after AR replay), so that customer master exists before contacts and AR math is finished before non-AR entities.

29. As a billing connector operator, I want post-import credit-insurance metrics (overdue, gap pipeline) to run after replay and maturity, so that dashboard KPIs match persisted invoice state.

30. As an archaser_admin, I want connector sync history to reflect deferred and matured payment counts, so that I can diagnose stuck deferred rows.

### Data integrity & queries

31. As a developer, I want all live AR queries to exclude deferred payments (`invoice_id IS NULL`), so that unlinked rows never affect totals, reports, or portal balances.

32. As a support engineer, I want deferred payments visible for diagnostics (count by account/customer, oldest unlinked), so that I can find orphan rows when invoice numbers do not match.

33. As a finance lead, I want deferred rows retained until linked, then promoted to normal `InvoicePayment`, so that audit trail is preserved.

34. As an accounts receivable clerk, I want payments that never match an invoice to remain deferred until manually corrected or purged, so that bad ERP data does not create phantom invoice links.

### Regression & coexistence

35. As an accounts receivable clerk importing payments against **existing** invoices, I want payments linked immediately or deferred consistently with the same rules, so that mixed historical and live workflows work.

36. As a product owner, I want this feature to extend the existing `InvoicePayment` model rather than introduce a parallel staging table, so that promotion to live payments is a single update.

37. As a developer, I want replay and maturity to share one **link and recalc** implementation, so that linking logic is not duplicated.

## Implementation Decisions

### Locked product decisions (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Scope | All import paths: file UI, payment/invoice APIs, billing connector |
| D2 | Deferred storage | Extend `InvoicePayment`: nullable `invoice_id`; `invoice_number` required when null |
| D3 | Unmatched invoice at payment ingest | **Deferred** outcome — not failure |
| D4 | Invoice `total_paid` authority | **Payments win** when payment records exist |
| D5 | Open AR at limit stamp | Only payments with `payment_date <= invoice_date` |
| D6 | Billing connector entity order | **Customer → Payment → Invoice → Contact** |
| D7 | Manual orchestration | **Separate tabs**; server replay on invoice job completion (not combined wizard) |
| D8 | Deferred idempotency | `@@unique([account_id, customer_id, reference])` unchanged |
| D9 | Manual UX | Two separate uploads; chronological replay is server-side |
| D10 | Late payments (`payment_date > invoice_date`) | Stay deferred until **payment_date** is reached |
| D11 | Synthetic invoice import payments | **Keep** for Invoice-Based accounts when no payment records |
| D12 | Unlinked retention | Until linked — no auto-expiry |
| D13 | Term breach on import | **Outstanding-driven** — no historical Due/Overdue/Paid replay by payment timeline |
| D14 | Late payment effect timing | Applied on **payment_date**, not at invoice create |
| D15 | Execution model | **Full chronological replay** after ingest |
| D16 | Future deferred maturity | **Billing connector scheduled sync** (per account when due) |
| D17 | Maturity lag | Next connector run on or after `payment_date` (not exact real-time) |

### Primary seam: chronological replay engine

Introduce one module (working name: **Import AR replay service**) that accepts per-customer inputs:

- Pending invoice rows (normalized import payloads or staging references)
- Deferred and live `InvoicePayment` candidates for that customer

It builds a sorted event list:

```
{ type: 'invoice_open', date: invoice_date, payload }
{ type: 'payment_apply', date: payment_date, payload }
```

Sort by date ascending; same-day tie-break: **invoice_open before payment_apply**.

For each event:

- **invoice_open** — create or update invoice; compute insurance fields; stamp `limit_assessed_amount` using cumulative open AR on the policy scope with payments applied only through payments on or before this `invoice_date`; persist outstanding from payments applied so far in the replay.
- **payment_apply** — set `invoice_id` on deferred row (or create if ingest already wrote deferred row); aggregate `total_paid` / `customer_total_paid`; update outstanding; recalc invoice capacity gap for affected invoices; update Paid status when customer outstanding reaches zero.

Return a summary: events applied, payments linked, deferred remaining, customers affected.

This is the **single test seam** for business rules. Callers (invoice import job completion, billing connector orchestration) supply inputs and persist outputs; they need only thin integration tests.

### Secondary seam: link deferred payment and recalc

Shared helper (working name: **link deferred payment and recalc**) used by:

- Replay engine (historical timeline)
- **Maturity pass** at end of billing connector sync

Inputs: deferred `InvoicePayment` id (or row), resolved `invoice_id`.

Behavior: link, aggregate totals on invoice, update outstanding, sync customer rollups, sync credit-insurance gap pipeline for that invoice — same as live `createInvoicePayment` side effects without duplicating logic.

### Schema changes

- `InvoicePayment.invoice_id` — nullable.
- `InvoicePayment.invoice_number` — required when `invoice_id` is null (enforce in application layer; optional DB check constraint if supported).
- All read paths that sum payments or AR must filter `invoice_id IS NOT NULL` unless explicitly querying deferred diagnostics.

No separate deferred-payment table.

### Payment ingest changes

- When invoice not found: create deferred `InvoicePayment`, return `deferred: true` result.
- When invoice found at ingest: still write deferred row OR write with `invoice_id` set but defer **application** to replay if batch is part of a replay-coordinated import; prefer consistent rule: **ingest always writes deferred when part of connector/manual coordinated flow**, replay links all. For standalone payment import against existing invoices, may link immediately if not followed by invoice replay in same job — document: standalone payment import on existing invoice uses immediate link path (live payment behavior).
- Duplicate reference: skip (existing behavior).
- Amount resolution: reuse `resolvePaymentImportAmounts` when invoice context exists for derivation.

### Invoice ingest changes

- Normalize and sort invoices (existing behavior).
- When payment records exist for invoice number: do not set `total_paid` from file; replay owns totals.
- On job completion (or last batch): invoke replay for `affectedCustomerIds`, then `triggerPostImportOverdueMetrics`.
- Remove synthetic `payment_date: today` when real payment records exist; keep Invoice-Based synthetic path per D11 when no payments.

### Billing connector orchestration

Per sync run, for each enabled entity in order:

1. **Customer** — existing upsert
2. **Payment** — deferred ingest only (no replay side effects per row)
3. **Invoice** — ingest only
4. **Replay** — affected customers from payment + invoice batches
5. **Maturity** — `applyMaturedDeferredPayments(accountId, asOf: startOfTodayUtc)` for rows with `invoice_id` null, `payment_date <= asOf`, matching invoice exists
6. **Contact** — existing upsert
7. **Post-import metrics** — credit-insurance sync for affected customers

Update `ENTITY_ORDER` from Customer → Contact → Invoice → Payment to Customer → Payment → Invoice → Contact.

Maturity runs on scheduled and manual connector sync when the connector executes — not when the global cron skips the connector as "not due". Accept lag up to the account's sync interval (e.g. every 6 hours).

### Manual import without connector

- Replay at invoice job completion covers all historical dates in the imported files.
- Future-dated deferred payments (payment_date after import day) **remain deferred** until the account runs billing connector sync or imports a later correction — document as limitation unless a future lightweight daily maturity cron is added.

### Import result contract

Extend payment import row results:

| Outcome | Meaning |
|---------|---------|
| `success` | Live payment linked and applied |
| `deferred` | Stored with `invoice_id` null; awaiting invoice or payment_date |
| `skipped` | Duplicate reference |
| `failed` | Validation or access error |

### Query guardrails

- Dashboard AR, customer header, reports, portal: exclude `invoice_id IS NULL`.
- Admin/diagnostic API or import result: may include deferred counts.

### Relationship to payment-import-derive-amount

That PRD covers optional base `amount` derivation. This PRD covers **ordering, deferral, replay, and maturity**. Both share payment ingest normalization; derivation runs at ingest when invoice context is available.

### ERP billing connector plan delta

Supersedes entity order decision D12 in the ERP billing connector plan: Payment before Invoice; Contact last. Replay and maturity are orchestration steps, not ERP entity types.

## Testing Decisions

### What makes a good test

- Test **observable outcomes**: outstanding balances, `total_paid`, `limit_assessed_amount`, capacity gap totals, deferred vs linked payment state — not internal event queue ordering unless exposed via outcomes.
- Use **fixed date fixtures** (invoice dates and payment dates in a known month) so replay order is deterministic.
- Prefer **pure replay tests** with in-memory or minimal DB fixtures over full HTTP import pipelines for rule coverage.

### Primary module under test

**Import AR replay service** — unit tests for:

- Invoice opens before any payment → full amount in open AR at stamp
- Payment on `invoice_date + 2` does not reduce stamp at `invoice_date`
- Multiple payments same invoice, different dates → outstanding steps correctly
- Two invoices same customer → cumulative open AR for second stamp
- Payment before invoice in ingest data → linked during replay on payment event after invoice open event
- Sample scenario from grill-me (customer 1111, Jan 2026 invoices and payments)

### Secondary module under test

**Link deferred payment and recalc** / **apply matured deferred payments**:

- Matures only when `payment_date <= asOf` and invoice exists
- Does not mature when invoice still missing
- Idempotent when reference already linked
- Recalculates capacity gap after link

### Integration tests (thin)

- Invoice import job completion triggers replay and updates gap KPIs for affected customer.
- Billing connector sync with Payment then Invoice batches runs replay and maturity in one run.
- Deferred payments excluded from AR totals in customer header API.

### Prior art

- `invoiceCapacityGapScenario.test.ts` — acceptance totals for gap rules
- `InvoiceService.createMany.test.ts` — import stamping behavior
- `ImportPaymentService` / `resolvePaymentImportAmounts` tests — payment ingest
- `syncBillingConnectors.test.ts` — connector cron wiring

### Seam confirmation

The intended **highest seam** is the **Import AR replay service** (pure chronological processor). Ingest layers stay thin; one comprehensive unit test suite on the replay seam should cover most business rules. Maturity is a thin wrapper calling the shared link-and-recalc helper — test with a small dedicated suite.

## Out of Scope

- Combined single-page AR import wizard (separate tabs retained).
- Separate `DeferredInvoicePayment` staging table.
- Historical replay of Due / Overdue / Paid **status transitions** by payment timeline.
- Real-time (sub-hour) maturity for future payment dates — connector schedule granularity is acceptable.
- Platform-wide daily maturity cron for manual-import-only accounts (documented gap; future enhancement).
- Auto-purge of orphan deferred payments after TTL.
- Changes to `ctv_payment_term` calculation formula (still invoice_date vs due_date vs max_payment_term).
- Translation file updates unless import result labels for `deferred` are added in a follow-up with explicit i18n approval.
- Payment allocation across multiple invoices (single invoice_number per payment row unchanged).

## Further Notes

### Sample data walkthrough (grill-me fixture)

Customer `1111`, January 2026: 25 invoices, 13 payments referencing invoice numbers. After replay:

- `5584561` (invoice Jan 1, payment Jan 3 for 150 of 250) — stamp at Jan 1 with 250 open; after Jan 3 payment, outstanding 100.
- `5584563` (invoice Jan 4, payments Jan 16 + Jan 21 totaling 1000) — stamp at Jan 4 with no payments applied yet; fully paid after second payment event.
- `5584564` (invoice Jan 5, payment Jan 25) — stamp at Jan 5 at full 900; payment applies on Jan 25 event only.

### Two executors summary

- **Replay** — Invoice job complete; payment job complete; backdated UI
  payment create; connector after Invoice or payment-only fallback.
  Restamps assessed limits for affected customers.
- **Maturity** — Connector after Invoice; also payment-only fallback.
  Applies deferred rows with `payment_date <= today` when the invoice
  exists.

### Manual import recommendation

Document recommended order: **customers (if new) → payments →
invoices**. Not enforced in UI except optional warning. When
invoices already exist, a later **payments-only** import must
still run chronological AR replay (see payment-triggered
addendum).

### Open follow-up

If manual-import accounts need future-dated payment maturity
without a connector, add a lightweight daily cron that calls
the same maturity helper for accounts with unlinked deferred
rows — explicitly deferred from MVP per D16.

## Implementation addendum — payment-triggered replay

Late payments (file import, backdated UI/API create, connector
payment-only sync) must run the **same chronological AR replay**
and **live overdue/MEP/capacity refresh** as invoice completion.
Past CustomerPolicyTrend / CreditDashboardDailySnapshot days
stay on **next-morning** as-of rewrite drain (no in-request
drain).

Authoritative ready-for-agent brief:
[payment-triggered-ar-replay.prd.md](./payment-triggered-ar-replay.prd.md)
(grill decisions D1–D10).

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Deferred Payment & Chronological AR Import](https://app.clickup.com/t/869dz43h4)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Deferred payments foundation — schema, AR guards, link-and-recalc | [869dz43nj](https://app.clickup.com/t/869dz43nj) | — | US 31, 33, 36, 37 |
| 2 | Deferred payment import — file API, job results, payment tab | [869dz43pf](https://app.clickup.com/t/869dz43pf) | 1 | US 1–8, 35 |
| 3 | Chronological AR replay engine — capacity gap timeline | [869dz43q9](https://app.clickup.com/t/869dz43q9) | 1 | US 14–19 |
| 4 | Manual invoice import — replay on job complete, payments win | [869dz43rz](https://app.clickup.com/t/869dz43rz) | 2, 3 | US 9–13, 20–23 |
| 5 | Billing connector — Payment→Invoice order, replay & maturity | [869dz43v5](https://app.clickup.com/t/869dz43v5) | 2, 3 | US 24–30 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development per `.cursorrules`
