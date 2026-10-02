---
name: future-payment-settle-gate
overview: Do not apply future-dated payments to invoice totals or Paid until payment_date; delay recon virtual close the same way; skip opening collection only for overdue invoices covered by such a payment.
source: grill-me session (Oct 2026) via /start-work
clickup_task_url: https://app.clickup.com/t/869fafv1w
isProject: false
---

# Future payment settle gate (Paid + collection open)

## Problem Statement

Reconciled ERP payments can be imported before their document payment date (`FNCDATE` / `payment_date`) because pulls window on recon day (`RECONDATE`). Today those rows still settle the invoice immediately: outstanding drops, status can become Paid, and recon virtual fill can close remaining debt on import day. Collection then treats the customer as collectible even though cash is only scheduled for a future day. Operators need the invoice to stay economically open until the payment date, and they need overdue→collection opening to ignore invoices that already have a covering future payment.

## Solution

Across all accounts, treat linked payments with `payment_date` after today as **not yet settled**:

1. Import/store them when the ERP row is available.
2. Do **not** reduce outstanding / `total_paid` and do **not** mark Paid until `payment_date <= today`.
3. For recon virtual close, delay virtual fill + Paid until the covering cash payment date has arrived; settle on the existing billing-sync maturity path.
4. `Process Overdue Invoices` may still flip Due→Overdue, but must **not** count an invoice toward opening a collection period when linked future-dated payment(s) would fully cover that invoice when matured.

## User Stories

1. As an AR operator, I want a post-dated reconciled payment to appear in Archaser before its payment date, so that I know cash is scheduled.
2. As an AR operator, I want the related invoice to keep its pre-settle outstanding until that payment date, so that aging and exposure stay truthful.
3. As an AR operator, I want the invoice to become Paid only on/after the payment date (via normal sync maturity), so that Paid matches when cash is effective.
4. As an AR operator on account 10149, I want recon virtual fill delayed the same way, so that a future `FNCDATE` does not force Paid on recon import day.
5. As a collections operator, I want overdue invoices that are fully covered by a future payment to stay out of new collection periods, so that we do not chase cash that is already scheduled.
6. As a collections operator, I want those invoices to still become Overdue if past due, so that status reflects lateness even when collection is suppressed.
7. As a collections operator, I want other overdue invoices on the same customer (without a covering future payment) to still open collection, so that real collectible debt is not blocked.
8. As a collections operator, I want escalation jobs unchanged for this feature, so that open periods continue to move categories as today.
9. As a credit analyst, I want live outstanding KPIs to ignore future-dated payments until maturity, so that dashboard AR matches settle rules.
10. As a billing connector operator, I want maturity to run on the existing connector sync / post-ingest path (no new daily cron), so that ops surface stays the same.
11. As a developer, I want one shared “effective as of today” payment application rule for totals/Paid, so that import, recon close, and maturity cannot drift.
12. As a developer, I want “covering future payment” for collection skip to use the same full-cover + paid-tolerance idea as Paid close, so that eligibility matches settle math.
13. As an AR operator, I want partial future payments that do not fully cover the invoice to still allow collection opening, so that residual debt remains collectible.
14. As an AR operator, I want already-matured payments (`payment_date <= today`) to keep today’s immediate apply/close behavior, so that normal receipts are unchanged.
15. As a support engineer, I want a clear How to test path for future-dated cash + overdue open, so that staging verification is repeatable.

## Implementation Decisions

- **Settle gate date:** `InvoicePayment.payment_date` (ERP `FNCDATE` for cash). Not `RECONDATE`.
- **Scope:** All accounts. Any linked payment with `payment_date > asOf` is excluded from outstanding / `total_paid` / Paid until maturity.
- **Interim invoice state:** Status may still follow Due/Overdue rules; economic fields ignore unsettled future payments.
- **Maturity trigger:** Extend billing-connector sync maturity / post-ingest (`applyMaturedDeferredPayments` and related recalc) so that when `payment_date <= asOf`, payments become effective and Paid/virtual close can run. No new standalone daily cron.
- **10149 recon virtual close:** Do not upsert virtual fill or force Paid on import when covering cash is still future-dated. Queue or re-run virtual close on maturity after cash payment date.
- **Recalc seam:** Centralize “payments effective as of `asOf`” in the paid/recalc path used after link and after maturity (prefer extending existing invoice payment recalc rather than forking per importer).
- **Collection open seam:** In `Process Overdue Invoices` / open-period creation, exclude invoices that have linked payment(s) with `payment_date > now` whose effective customer amounts would fully cover the invoice within paid tolerance when matured. Still allow Due→Overdue for those invoices.
- **Granularity:** Per invoice. Sibling overdue invoices without a covering future payment can still open a customer collection period.
- **Escalation out of this change:** `Process Automated Collection Periods` and `Move Collection To Next Category` stay as today.
- **Coverage definition:** Full cover when matured (sum of those future linked payments vs customer net / outstanding within paid tolerance). Partial future cover does not suppress collection open.
- **i18n:** No new user-facing copy expected; if any UI/tooltip is added, ship EN+HE together.
- **Schema:** Prefer behavior change without new columns; only add a marker if the shared as-of filter cannot express pending recon virtual work safely.

## Testing Decisions

- Prefer behavior seams over implementation unit tests; do not add automated tests unless explicitly requested later.
- **Seam A — settle as-of:** Given linked payments with future `payment_date`, invoice outstanding/`total_paid`/status Paid behave as if those payments are absent until `asOf` reaches the date; then maturity applies them and Paid/close runs.
- **Seam B — recon delay:** Reconciled 10149 row with future cash date does not create an effective virtual Paid close on import day; after maturity date, virtual fill + Paid occur as today.
- **Seam C — collection open:** Past-due invoice with covering future payment becomes Overdue but does not alone open a collection period; a second overdue invoice without future cover can open the period.
- Manual How to test steps live on the ClickUp task and in each vertical slice.

## Out of Scope

- Changing escalation / next-category timing for already-open collection periods.
- New daily cron solely for maturity.
- UI to list or badge “future payments” (unless a tiny operator affordance is requested later).
- Changing pull watermark (`RECONDATE`) behavior from `a6c1230`.
- Reworking deferred `invoice_id = null` import beyond what maturity already does, except where the shared as-of rule must apply.
- Historical backfill scripts for invoices already incorrectly marked Paid by future payments (optional follow-up).

## Further Notes

- ClickUp: https://app.clickup.com/t/869fafv1w
- Branch (primary repo): `feat/future-payment-settle-gate-CU-869fafv1w`
- Related prior work: RECONDATE payment pull watermark (`a6c1230`); account 10149 recon virtual close; deferred payment maturity.
