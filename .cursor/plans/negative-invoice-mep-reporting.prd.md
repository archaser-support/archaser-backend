---
name: negative-invoice-mep-reporting
overview: Credit notes (invoice amount less than zero) must not receive target MEP or target reporting dates, must not gain new reporting breach, and must be excluded from reporting countdown, action-window alerts, and terms/reporting-breach invoice lists — without changing customer MEP or payment-term logic.
source: grill-me session (negative invoices MEP & reporting)
clickup_task_url: null
isProject: false
---

# Negative invoices — exclude from MEP and reporting dates

## Problem Statement

Credit insurance stamps **target MEP date** and **target reporting date** on every invoice from due date plus policy offsets (with optional month-end cutoff). Credit notes are stored as invoices with **negative amount**. Today those rows get the same dates and can:

- Appear in reporting countdown and “days left to report” lists
- Fire reporting action-window notifications
- Be promoted to `reporting_breach` by create/import or the daily overdue metrics sweep
- Show up in terms-breach / reporting-breach invoice queries when flags or dates remain set

Operators and credit analysts treat credit notes as offsets, not insurer-reportable AR lines. Negative invoices should not drive MEP or reporting deadlines or the surfaces that depend on those deadlines.

Customer-level MEP (oldest overdue due date and overdue block) must stay as today — this change is invoice-row and list/query scoped only.

## Solution

Treat **amount less than zero** as the credit-note signal.

On every insurance date write path (create, import, due-date refresh, as-of stamp, and amount update):

- Set `target_mep_date` and `target_reporting_date` to null for negative-amount invoices
- Never set `reporting_breach` to true for those rows (including cron / batch sweep)
- Do not clear an existing `reporting_breach` on date-only refresh (full stamp may still rewrite breach from the shared compute helper when it runs)

On credit-insurance **read** paths that surface reporting deadlines or breach lists:

- Exclude invoices with amount less than zero from reporting countdown, action-window notification candidates, and terms-breach / reporting-breach invoice membership and KPI queries

Do **not** run a one-time cleanup of historical credit-note dates. Untouched old rows may keep dates on disk until restamped; read filters keep them out of CI lists and alerts.

Leave payment term, other created-in-terms-violation flags, capacity gap, and customer overdue-block math unchanged.

## User Stories

1. As a credit operations user, I want a newly imported credit note (negative amount) to have empty target MEP and target reporting dates, so that credit notes are not treated as reportable insured invoices.

2. As a credit operations user, I want a newly created credit note via API to get the same empty target dates, so that all create paths stay consistent.

3. As a credit operations user, I want connector or file import of a negative-amount invoice to skip MEP and reporting target dates, so that ERP credit notes match product rules.

4. As a credit analyst, I want reporting countdown lists to omit credit notes, so that “days left to report” only shows positive AR.

5. As a credit analyst, I want reporting action-window notifications to ignore credit notes, so that teams are not reminded to report offsets.

6. As a credit analyst, I want terms-breach and reporting-breach invoice lists to omit credit notes, so that dashboards do not mix credit notes into breach worklists.

7. As a credit analyst, I want reporting-breach KPI counts to exclude credit notes, so that portfolio metrics reflect true invoice risk.

8. As a credit operations user, I want the daily reporting-breach sweep to never turn on breach for a negative-amount invoice, so that cron cannot create false breaches on credit notes.

9. As a credit operations user, I want due-date refresh on a credit note to keep target MEP and reporting dates null, so that edits do not reintroduce deadlines.

10. As a credit operations user, I want as-of / chronological insurance stamping on a credit note to leave target MEP and reporting dates null, so that replay cannot restamp deadlines onto offsets.

11. As a credit operations user, I want changing an invoice amount from positive to negative to refresh insurance fields and clear those target dates, so that a correction immediately stops MEP/reporting treatment.

12. As a credit operations user, I want changing an invoice amount from negative to positive to refresh insurance fields and compute normal target dates, so that a corrected real invoice gets insurer deadlines.

13. As a credit manager, I want customer oldest overdue date and overdue block to still consider overdue invoices the same way as today (including negatives if they are Overdue), so that this delivery does not change customer MEP exposure signaling.

14. As a credit analyst, I want payment term and payment-term breach on credit notes to keep working as today, so that this change does not alter payment-term product behavior.

15. As a credit analyst, I want other created-in-terms-violation flags on credit notes to keep working as today, so that exclusion, DCL, and policy-end snapshots are unchanged.

16. As a support engineer, I want existing credit notes that already have target dates left alone by a batch job, so that we do not rewrite history in one shot.

17. As a support engineer, I want those old credit notes still hidden from countdown, action-window, and breach lists via amount filters, so that operators stop seeing them without a migration.

18. As a support engineer, I want restamping a touched old credit note to null its target MEP and reporting dates going forward, so that gradual cleanup happens on normal write paths.

19. As a QA engineer, I want a positive-amount invoice to keep receiving target MEP and reporting dates as today, so that the skip is limited to negatives.

20. As a QA engineer, I want a zero-amount invoice to still receive normal target dates, so that only strictly negative amounts are excluded.

21. As a platform engineer, I want one shared compute rule for “negative amount means no target MEP/reporting dates,” so that create, import, refresh, and as-of cannot drift.

22. As a platform engineer, I want amount-aware skip applied in both Nest API and reports credit-insurance domain copies where helpers are duplicated, so that live and reports paths stay aligned.

23. As a product owner, I want no Prisma schema or translation changes for this work, so that rollout stays behavior-only.

24. As a product owner, I want capacity gap and assessed-limit behavior on credit notes left out of this delivery, so that scope stays MEP/reporting dates and related surfaces.

25. As a credit dashboard user, I want portfolio health historical snapshots left as already stored, so that this change is forward-looking for writers and live list filters only.

26. As a developer, I want invoice amount updates to trigger the same insurance field refresh used for date edits, so that sign flips are not stuck until a later cron.

27. As a compliance reviewer, I want reporting_breach not cleared solely by a date-only refresh that nulls targets on a credit note, so that audit-style breach clearing rules stay narrow (actual reporting date or full stamp rewrite only).

28. As an operations engineer, I want logs or tests to make the negative-amount skip observable at the compute seam, so that regressions are easy to catch.

## Implementation Decisions

- **Negative definition:** `amount < 0` only. Do not use outstanding debt, credit-for link fields, or zero amount.
- **Write rule:** When amount is negative, persist `target_mep_date = null` and `target_reporting_date = null` on every path that computes or refreshes those fields (create, import, target-date refresh, as-of stamp, amount-triggered refresh).
- **Shared compute:** Extend the shared invoice insurance row computation so callers pass amount (or an equivalent negative flag) and the helper returns null targets for negatives. Prefer one rule over per-call-site branching.
- **Reporting breach (writers):** Never promote `reporting_breach` to true when amount is negative (single-invoice sync, batch sweep, and any path that uses “should set reporting breach”). Date-only target refresh that nulls dates must not actively clear an existing true breach; full stamp may write breach from compute (false when targets are null).
- **Amount update:** Whenever invoice amount is updated, refresh insurance target dates (and related insurance fields already refreshed on that path) so sign flips apply immediately.
- **Read rule:** Exclude `amount < 0` from reporting countdown membership/queries, action-window invoice selection for notifications, terms-breach invoice membership/outstanding queries, and reporting-breach invoice counts/lists used by the credit dashboard.
- **Customer MEP:** Exclude `amount < 0` from `oldest_invoice_overdue_date` / `overdue_block` sync and as-of replay. When `overdue_block` changes, refresh open-invoice CTV snapshots so `ctv_customer_overdue_mep` clears. Collection overdue counts on `Customer` (`number_of_overdue_invoices`) unchanged.
- **Payment term / other CTV:** Out of scope — leave as today.
- **Existing rows:** No one-time SQL/migration cleanup. Read filters hide stale dates/flags; writers clear dates when a row is restamped.
- **Duplicated domain:** Keep Nest API and reports package helpers behavior-aligned where both compute or query these fields.
- **No schema / i18n:** No Prisma migrations; no translation file changes.
- **Related PRDs:** Month-end cutoff math (`policy-mep-reporting-cutoff-days`) remains the formula for positive invoices; this PRD only gates when those dates apply.

### Grill decision log (D1–D12)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Scope of exclusion | Null targets on negative rows; customer MEP oldest-overdue excludes `amount < 0` |
| D2 | How to recognize negative | `amount < 0` only |
| D3 | Existing credit notes | No one-time cleanup job |
| D4 | Refresh / as-of | Always skip target dates when `amount < 0` on every write path |
| D5 | Reporting breach | Never set new breach on negatives; do not clear on date-only refresh |
| D6 | Payment term | Out of scope — leave alone |
| D7 / D12 | Other CTV flags | No change |
| D8 | Amount sign flip | Refresh insurance fields whenever amount is updated |
| D9 | Countdown / action window | Exclude `amount < 0` |
| D10 | Terms/reporting-breach lists | Exclude `amount < 0` |
| D11 | Plan home | Standalone PRD `negative-invoice-mep-reporting` |

## Testing Decisions

- Good tests assert external behavior: given amount and dates/status, target fields and breach outcomes match the rules; given query helpers, negative amounts are absent from countdown / action-window / breach membership.
- Prefer the fewest seams. Do not assert internal loop counters or call graphs.

### Chosen seams

1. **Invoice insurance row computation (primary)** — For `amount < 0`, target MEP and target reporting dates are null; reporting-breach evaluation for that row does not become true from null targets. For `amount >= 0`, existing date math (including month-end cutoff) unchanged. Cover refresh helpers that recompute targets by amount.
2. **Credit-insurance read membership / notification candidate selection (thin)** — Reporting countdown, action-window invoice fetch, and terms/reporting-breach membership (or equivalent where builders) exclude `amount < 0`.
3. **Amount-update refresh (thin)** — Updating amount triggers insurance target refresh so negative clears dates and positive recomputes them.

### Prior art

- Unit coverage around invoice insurance date helpers and month-end cutoff examples in the policy MEP/reporting cutoff work.
- Credit dashboard membership helpers and notification rule evaluator action-window selection.
- Daily overdue metrics reporting-breach sweep behavior.

## Out of Scope

- Payment term and `ctv_payment_term` changes for credit notes.
- Forcing or clearing other created-in-terms-violation flags on credit notes.
- Changing customer oldest overdue date or overdue block to ignore negative invoices.
- One-time batch cleanup of historical target dates or reporting breach on credit notes.
- Capacity gap, assessed limit, or open-AR formula changes for credit notes.
- Report builder column metadata or ad-hoc report filters (raw columns may still show stored dates on old rows).
- Portfolio Health / daily snapshot rewrite of past days.
- Schema migrations and translation updates.
- UI copy or new settings screens.

## Further Notes

### Discovery gates

| Gate | If Yes | If No |
|------|--------|-------|
| Shared insurance row helper can accept amount and centralize null targets | Prefer that as the only write rule | Gate each writer; higher drift risk |
| API and reports both own insurance date / membership helpers | Update both for parity | Single module only |
| Invoice amount update already has a refresh hook | Reuse for D8 | Add refresh on amount change for API and import/connector upserts |

### Suggested follow-ups (out of scope unless requested)

- Optional one-time cleanup job for historical credit-note target dates.
- Exclude negatives from customer MEP oldest-overdue if product later wants that.
- Report-builder default filters that hide negative amounts for insurance date columns.

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under `.scratch/negative-invoice-mep-reporting/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.scratch/negative-invoice-mep-reporting/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Null target dates and never set reporting breach on negatives | `issues/01-null-targets-and-breach-writers.md` | — | 1–3, 8–10, 13–16, 18–22, 27–28 |
| 2 | Refresh insurance dates when amount changes | `issues/02-amount-update-refresh.md` | 01 | 11, 12, 26 |
| 3 | Exclude negatives from CI lists and alerts | `issues/03-exclude-negatives-from-ci-lists.md` | — | 4–7, 17 |

**Status:** `ready-for-agent` on all slices.

*Soft ordering:* slice 03 can proceed in parallel with 01; slice 02 waits on 01.
