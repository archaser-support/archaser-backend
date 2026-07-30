---
name: payment-triggered-ar-replay
overview: Run chronological AR replay and live overdue/MEP/capacity refresh when payments land late (file import, backdated UI/API create, connector payment-only sync), while past snapshot days stay on next-morning as-of rewrite drain.
source: grill-me session (payment import same replay as invoice + late payment recalculation)
clickup_task_url: null
isProject: false
---

# Payment-triggered AR replay — PRD

Status: ready-for-agent

## Problem Statement

Credit-insurance capacity gap, MEP (Maximum Extension Period — overdue-block
breach rules), and related live customer metrics depend on chronological AR
(accounts receivable) replay: walking invoice opens and payments in date order
and re-stamping assessed limits.

Today that replay (and the live overdue/MEP/capacity refresh) runs when an
**invoice** import job finishes, and when the billing connector finishes its
**Invoice** step. A **payment** import job does not run replay. A single UI/API
payment create does not run replay either.

Operators often receive payments **days after** the real `payment_date`.
Example: invoices already exist; on Thursday they import a payment dated Monday.
Open AR and later invoice capacity stamps can stay wrong until something else
replays. Past daily history tables are already queued for as-of rewrite, but
live cards (capacity gap, MEP, terms-related metrics) can look wrong immediately
after the payment lands.

## Solution

Whenever payments land in a way that can change historical open AR, run the
**same chronological AR replay** used after invoice import for the affected
customers, then the **same live overdue/MEP + capacity-gap pipeline**, and keep
relying on the existing **as-of rewrite queue** so CustomerPolicyTrend and
CreditDashboardDailySnapshot past days correct on the **next morning** drain
(not inside the payment request).

Cover three entry points:

1. **File/API payment import** — on job complete, always replay + live refresh
   for affected customers (then existing as-of enqueue).
2. **UI/API single linked payment create** — replay + live refresh only when
   `payment_date` is before today (backdated / late).
3. **Billing connector** — keep today’s replay after Invoice when invoices ran;
   if the sync touches payment customers but Invoice did not run (or did not
   take the replay path), run replay + maturity + live refresh after Payment
   instead.

This PRD extends
[deferred-payment-chronological-import.prd.md](./deferred-payment-chronological-import.prd.md).
Snapshot drain timing stays owned by
[as-of-daily-snapshot-rewrite.prd.md](./as-of-daily-snapshot-rewrite.prd.md).

## User Stories

1. As an accounts receivable clerk, I want payment file import to re-run
   chronological AR replay when the job finishes, so that late payments restamp
   capacity-gap basis correctly.
2. As an accounts receivable clerk, I want payment file import to refresh
   overdue/MEP and live capacity gap the same way invoice import does, so that
   customer cards match soon after I upload.
3. As an accounts receivable clerk, I want a payment import that mixes
   today-dated and older rows to always replay, so that I do not miss one late
   row in a large file.
4. As an accounts receivable clerk, I want payment import to keep enqueueing
   as-of rewrite from the earliest payment date, so that past trend days are
   corrected without blocking my upload.
5. As a credit analyst, I accept that past CustomerPolicyTrend and dashboard
   snapshot days update by the next morning after a late payment, so that
   imports stay fast.
6. As a credit analyst, I want live capacity gap after a late payment import to
   reflect chronological replay, so that I do not wait for an invoice re-import.
7. As a credit analyst, I want MEP / overdue-related customer and invoice fields
   refreshed after payment import, so that breach exposure matches the new open
   AR.
8. As a credit manager, I want a backdated payment created in the UI to trigger
   chronological AR replay, so that clerk data entry has the same correctness as
   file import.
9. As a credit manager, I want a same-day UI payment create to keep the lighter
   existing side effects (no full customer replay), so that busy payment entry
   stays responsive.
10. As a credit manager, I want UI backdated payment create to also run the live
    overdue/MEP/capacity refresh, so that header and dashboard cards update in
    the same session.
11. As a credit manager, I want UI same-day payment create to keep enqueueing
    as-of rewrite when the payment date affects history windows that still need
    correction, so that snapshot policy stays consistent with today’s
    PaymentService behavior.
12. As a billing connector operator, I want a full Payment→Invoice sync to keep
    a single replay after Invoice, so that we do not double-run replay every
    night.
13. As a billing connector operator, I want a payment-only (or invoice-skipped)
    sync that touched payment customers to run chronological AR replay, so that
    late ERP payments are not left without restamp.
14. As a billing connector operator, I want that payment-only fallback to run
    maturity as well, so that deferred payments whose invoice already exists
    still link when `payment_date` is eligible.
15. As a billing connector operator, I want that payment-only fallback to run
    the live overdue/MEP/capacity refresh, so that connector-only payment runs
    match file import outcomes.
16. As an admin reviewing import results, I want payment job complete to report
    replay statistics like invoice jobs when replay ran, so that I can audit
    backfill outcomes.
17. As a developer, I want one shared replay + live-refresh orchestration used
    by invoice and payment completion paths, so that the two cannot drift.
18. As a developer, I want unit tests that prove payment job complete calls
    replay and post-import refresh, so that regressions are caught without a
    full UI run.
19. As a developer, I want unit tests that prove UI create replays only when
    payment date is before today, so that the backdated rule stays explicit.
20. As a developer, I want unit tests that prove connector payment-only fallback
    runs replay, maturity, and live refresh, so that Invoice-skipped syncs stay
    covered.
21. As a credit analyst, I want assessed `limit_assessed_amount` values
    rewritten by payment-triggered replay using the same open-AR-at-invoice-open
    rules as invoice-triggered replay, so that capacity gap math stays one
    product rule.
22. As an operations user, I want payment import that only creates deferred rows
    (invoice not found yet) to still replay affected customers when other
    invoices exist, so that unrelated open AR on that customer stays consistent.
23. As an operations user, I want deferred rows that remain unlinked after
    payment import to wait for later invoice import or maturity, so that we do
    not invent invoice links.
24. As a credit analyst, I do not want payment-triggered work to change the
    as-of rewrite drain cadence, so that Portfolio Health history still follows
    the next-morning plan.
25. As an ARchaser admin, I want this behavior documented as an addendum to the
    deferred-payment chronological import plan, so that payment and invoice
    triggers live in one rule set.
26. As a QA engineer, I want to verify on the Import Payments page that
    finishing a job with existing invoices updates capacity gap without
    re-importing invoices, so that the July late-payment scenario is
    reproducible in the UI.
27. As a QA engineer, I want to verify a UI payment dated five days ago updates
    live metrics, while a payment dated today does not force full customer
    replay, so that D6 is observable.
28. As a platform engineer, I want payment job complete failures in replay to
    surface similarly to invoice job complete (logged / job metadata), so that
    ops can diagnose without silent skip.
29. As a credit insurance account user on Payment-Based balance evaluation, I
    want payment import replay to reconcile totals the same way invoice-job
    replay does, so that Payment-Based and deferred-payment rules stay aligned.
30. As a product owner, I want same-day file payment imports to still always
    replay, so that batch files remain a simple always-on path even when UI
    same-day creates stay light.

## Implementation Decisions

- Extend import job complete so `ImportType.Payment` runs chronological AR
  replay for `affectedCustomerIds` the same way `ImportType.Invoice` does today,
  then merges replay stats into job metadata when present.
- After payment-job replay, call the same post-import overdue/MEP + capacity
  pipeline used for invoice jobs (`triggerPostImportOverdueMetrics` with
  affected customer ids).
- Keep payment and invoice job complete order as: chronological AR replay (when
  applicable) → live overdue/MEP/capacity refresh (when applicable) → existing
  as-of rewrite enqueue for Invoice/Payment (unchanged next-morning drain).
- Do not drain the as-of rewrite queue inside payment job complete; D3 keeps
  cron drain.
- File/API payment import always runs replay + live refresh on successful
  completion when there are affected customers (no “only if backdated” filter on
  the batch path).
- UI/API linked payment create (`PaymentService.createInvoicePayment`): after
  existing link side effects and as-of enqueue, run chronological AR replay +
  live overdue/MEP/capacity refresh **only when** `payment_date` is strictly
  before start of today (UTC day boundary consistent with existing credit date
  helpers).
- Same-day UI/API payment create keeps current behavior aside from any shared
  helper cleanup; no full customer chronological replay.
- Billing connector: when the Invoice entity step runs, keep a single
  post-Invoice orchestration (replay, maturity, live refresh) as today.
- Billing connector payment-only fallback: if Payment ingest touched AR
  customers and the Invoice step did **not** run the post-Invoice orchestration
  in that sync, run replay + maturity + live refresh using the accumulated
  payment-affected customers after Payment (or at the equivalent fallback
  point).
- Prefer extracting a small shared “run AR post-ingest for customers” helper
  (replay ± maturity flag ± live refresh) so invoice job complete, payment job
  complete, UI backdated create, and connector paths share one orchestration —
  avoid copy-paste drift.
- No Prisma schema changes required for MVP.
- No translation file changes for MVP.
- Document as authoritative product addendum under the deferred-payment
  chronological import PRD; this file is the detailed ready-for-agent PRD for
  implementation and `/to-issues`.

## Testing Decisions

- Good tests assert **external behavior** at orchestration seams: given a
  payment completion or create path, chronological AR replay and live refresh
  are invoked (or not) per the rules above. Do not assert internal loop counters
  inside the replay engine (already covered by import AR replay unit tests).
- Prefer the highest existing seams: 1. Import job complete handler (Payment vs
  Invoice). 2. `PaymentService.createInvoicePayment` (backdated vs same-day). 3.
  Billing connector sync orchestration (Invoice path once; payment-only fallback
  with maturity).
- If a shared post-ingest helper is introduced, unit-test that helper once and
  keep path tests thin (they call the helper with the right flags).
- Prior art:
  - `importArReplayService` / `ImportPaymentService` unit tests
  - `PaymentService.createInvoicePayment.test.ts`
  - Billing connector sync / `syncBillingConnectors` wiring tests
  - Invoice job complete behavior from deferred-payment slice 4

### Testing Decisions — chosen seams

1. **Import job complete (Payment)** — Always calls replay + post-import
   refresh for affected customers; still enqueues as-of rewrite; does not
   require invoice re-import.
2. **PaymentService create** — Backdated `payment_date` triggers replay +
   refresh; same-day does not.
3. **Billing connector orchestration** — Full sync still replays once after
   Invoice; payment-only fallback runs replay + maturity + refresh.

Ideal: one shared orchestration helper tested thoroughly; the three callers
assert they invoke it with the correct options.

## Out of Scope

- Immediate (in-request) drain of as-of rewrite for past CustomerPolicyTrend /
  CreditDashboardDailySnapshot days.
- Changing as-of rewrite queue merge rules or cron drain ownership.
- Platform-wide daily maturity cron for manual-import-only accounts (still the
  deferred-payment open follow-up).
- Combined invoice+payment import wizard.
- Payment update/delete chronological replay (no primary update/delete
  PaymentService paths in scope unless already present and trivially wired).
- Always replaying on same-day UI payment create.
- Double replay on every connector sync that includes both Payment and Invoice.
- Translation / i18n updates.
- Schema migrations.
- Changing golden-loop / 123456 harness fixtures unless a regression appears.

## Further Notes

### Locked grill decisions (D1–D10)

- **D1** Payment import replay — Yes, same replay on payment job complete.
- **D2** Live overdue/MEP/capacity after payment import — Yes, same refresh.
- **D3** Past snapshot days — Keep next-morning cron drain.
- **D4** Entry points — Import + UI/API single payment + connector
  payment-only fallback.
- **D5** Connector timing — After Invoice when invoices ran; else after
  Payment if payment customers touched.
- **D6** UI/API single payment — Replay + live refresh only when
  `payment_date` is before today.
- **D7** Connector payment-only maturity — Yes, run maturity on fallback.
- **D8** File payment import cadence — Always replay + live refresh on job
  complete.
- **D9** Docs — Addendum on deferred-payment chronological import PRD (this
  file is the detailed agent brief).
- **D10** Testing — Unit tests for the three seams above.

### Relationship to July late-payment QA

Manual QA on Import pages remains: Payments tab then (if needed) Invoices; for
invoices already present, Payments-only import after this work should restamp
live metrics. Day-by-day historical spreadsheet compare stays harness/timeline
territory, not live dashboard cards.

### Next step

Vertical slices published under
`.scratch/payment-triggered-ar-replay/issues/` — see
**Issues (vertical slices)** below.

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under
`.scratch/payment-triggered-ar-replay/`. **Hard blockers** are recorded
in each slice's **Blocked by** header. Implement in dependency order;
start a **fresh session per issue**.

**Overview:** `.scratch/payment-triggered-ar-replay/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
| --- | --- | --- | --- | --- |
| 1 | Shared post-ingest helper + payment job complete | `issues/01-shared-helper-payment-job-complete.md` | — | 1–7, 16–18, 21–24, 26, 28–30 |
| 2 | Backdated UI/API payment create | `issues/02-backdated-ui-payment-create.md` | 01 | 8–11, 19, 27 |
| 3 | Connector payment-only fallback | `issues/03-connector-payment-only-fallback.md` | 01 | 12–15, 20 |

**Status:** `ready-for-agent` on all slices.
