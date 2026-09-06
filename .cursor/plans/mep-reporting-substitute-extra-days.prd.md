---
name: mep-reporting-substitute-extra-days
overview: Change MEP and Reporting substitute from next-month day-of-month diff to adding 1–365 extra calendar days onto the original target date; rename DB/API fields; leave Payment Term on the old formula.
source: grill-me session (/start-work)
clickup_task_url: https://app.clickup.com/t/869exp85r
isProject: false
---

# MEP / Reporting Substitute Extra Days

## Problem Statement

Credit operations configure optional month-end rules on insurance policies and customer policies. Today, when an invoice is issued on or after the MEP (or Reporting) cutoff day-of-month, the system extends the target deadline by a **diff**: calendar days from the invoice date to a substitute **day-of-month in the next calendar month**.

That no longer matches the insurer rule. The substitute value should mean **extra calendar days added to the original target** (`due_date + offset`), not a calendar day in the following month. The field name and validation still say “day of month” (1–31), which misleads admins and blocks valid larger extensions.

Payment-term month-end substitute must keep today’s next-month-day behavior. Existing stored invoice `target_mep_date` / `target_reporting_date` values should not be bulk-rewritten; any later natural refresh may pick up the new math.

## Solution

1. **New MEP / Reporting math** (when both cutoff and substitute are set, and invoice day-of-month is on or after cutoff):
   - Original target = `due_date + offset_days` (MEP offset = `max_allowed_mep`; Reporting offset = `reporting_days`).
   - Final target = original target **plus** the substitute value as calendar days.
   - Before cutoff, or if either field of the pair is unset: keep `due_date + offset_days` only.
2. **Rename** stored / API / import fields:
   - `mep_substitute_day_of_month` → `mep_substitute_extra_days`
   - `reporting_substitute_day_of_month` → `reporting_substitute_extra_days`
3. **Validation** for those two fields: integer **1–365**. Cutoff fields and Payment Term substitute stay day-of-month **1–31**.
4. **UI labels (EN):** “MEP Substitute Extra Days” / “Reporting Substitute Extra Days” (Hebrew updated to match). Pairing rules unchanged (cutoff and substitute both set or both empty).
5. **Payment Term** cutoff/substitute: **unchanged** formula and field names.
6. **No one-off backfill** of invoice targets. No migration of existing numeric substitute values (a stored `2` keeps the number; meaning becomes “+2 days” on the next refresh).
7. **Policy import:** hard rename of CSV headers only — old substitute headers are rejected (no aliases).

## User Stories

1. As a credit operations user, I want late-month invoices (on/after MEP cutoff) to get `due_date + max_allowed_mep + mep_substitute_extra_days` as target MEP date, so that deadlines match the insurer’s extra-days rule.
2. As a credit operations user, I want invoices issued before the MEP cutoff to keep `due_date + max_allowed_mep`, so that mid-month invoices are unaffected.
3. As a credit operations user, I want the same extra-days rule for Reporting (`due_date + reporting_days + reporting_substitute_extra_days` when on/after reporting cutoff), so that filing deadlines stay consistent with MEP-style rules.
4. As a credit operations user, I want Payment Term substitute to keep the old next-month-day adjustment, so that payment-term breach logic does not change in this release.
5. As a credit insurance administrator, I want fields named and labeled as substitute extra days, so that I am not told they are calendar days of the month.
6. As a credit insurance administrator, I want to enter substitute values from 1 through 365, so that longer extensions are allowed.
7. As a credit insurance administrator, I want cutoff and substitute to remain a required pair, so that incomplete month-end config cannot be saved.
8. As a credit insurance administrator, I want clearing the cutoff to clear the substitute, so that pairs stay consistent in the UI.
9. As a policy importer, I want CSV columns `mep_substitute_extra_days` and `reporting_substitute_extra_days`, so that imports match the API.
10. As a policy importer, I want old substitute day-of-month headers to fail clearly, so that stale templates are not silently accepted.
11. As a developer, I want schema columns renamed on Insurance Policy, Customer Policy, and Customer Policy Trend (and any mirrored policy snapshot fields), so that storage matches the new meaning.
12. As a developer, I want MEP/Reporting target helpers to add extra days while Payment Term still uses the shared next-month diff helper, so that the two behaviors can coexist safely.
13. As a QA engineer, I want a concrete example (invoice on cutoff day, known due date, offset, and extra days) documented, so that target dates are easy to verify.
14. As a credit analyst, I want existing invoice target dates left alone until a natural refresh, so that historical rows are not silently rewritten in bulk.
15. As a credit analyst, I want any later insurance refresh (policy edit, amount change, sync) to recompute targets with the new formula, so that refreshed rows stay correct going forward.
16. As a product owner, I want existing stored substitute numbers left as-is without remapping, so that we avoid guessing old→new conversions.
17. As a frontend user on customer and policy forms, I want EN and HE labels and validation messages updated for the new range and names, so that errors make sense.
18. As a compliance reviewer, I want import and API validation to reject 0 and values above 365 for extra-days fields, so that invalid extensions cannot be saved.

## Implementation Decisions

### Formula (MEP and Reporting only)

When cutoff and substitute-extra-days are both set and `invoice_date` day-of-month ≥ cutoff:

`target = due_date + offset_days + substitute_extra_days`

Otherwise (missing pair, missing invoice date for the gate, or day before cutoff):

`target = due_date + offset_days`

(Null when `due_date` or offset is missing — same as today.)

Example: due 26 Jun, `max_allowed_mep` 30, substitute extra days 2, invoice on/after cutoff → target MEP **28 Jul** (26 Jun + 30 + 2).

### Payment Term

Keep `computeMonthEndCutoffDiffIfApplicable` / next-month substitute-day logic for payment-term breach only. Do not rename `payment_term_substitute_day_of_month`.

### Schema / API rename

Rename columns and all read/write paths:

- `mep_substitute_extra_days`
- `reporting_substitute_extra_days`

Tables at minimum: `InsurancePolicy`, `CustomerPolicy`, `CustomerPolicyTrend`. Use a safe rename migration (preserve values). Prefer `npx prisma db push` for local/dev alignment per project norms; ship a SQL rename migration artifact consistent with existing credit-insurance migrations if that is the team’s deploy path.

### Validation

- Cutoff fields (MEP, Reporting, Payment Term): still 1–31.
- MEP / Reporting substitute extra days: 1–365.
- Payment Term substitute: still 1–31.
- Pair rules unchanged for all three pairs.

Split validation helpers so day-of-month parsers are not reused for extra-days fields without range changes (backend + frontend `monthEndCutoffFields` modules).

### UI / i18n

Update customer credit-insurance edit, policy create/edit, and import field catalogs. EN labels as decided; HE translations required (explicit permission granted by this PRD for these keys only). Import help text must describe “extra calendar days added to the original target when cutoff applies,” not next-month day-of-month.

### Refresh / backfill

- No batch rewrite script in this feature.
- Any code path that already recomputes invoice insurance targets continues to call the updated helpers (new math applies then).

### Testing seam

Prefer the existing pure helpers that compute target MEP / target reporting dates (and payment-term breach) in the credit-insurance domain module — highest seam that already has prior art in API unit tests. Do not require new automated tests unless explicitly requested later; manual How to test on slices is enough for delivery.

## Testing Decisions

- Good tests assert **external date outcomes** (given invoice date, due date, offsets, cutoff, substitute → expected target dates / breach flags), not internal helper names.
- Modules under test if tests are later requested: invoice insurance target-date helpers; month-end field validation (range + pairing); import policy column mapping.
- Prior art: `api/test/invoice-insurance-negative-amount.test.ts` (month-end MEP example), `api/test/import-policy.service.test.ts`, shared frontend/backend `monthEndCutoffFields` validators.
- Manual QA remains the default delivery bar for slices unless the user asks for automated tests.

## Out of Scope

- Changing Payment Term substitute formula or field names.
- One-off backfill / rewrite of existing `target_mep_date` / `target_reporting_date`.
- Remapping or clearing existing substitute numeric values.
- Import aliases for old CSV headers.
- Renaming cutoff fields (`*_cutoff_day_of_month`).
- Customer-level overdue MEP KPI formula changes beyond whatever already consumes invoice `target_mep_date`.
- New automated test suites (unless later explicitly requested).

## Further Notes

### Acceptance example

- Cutoff 24, `mep_substitute_extra_days` 2, `max_allowed_mep` 30  
- Invoice 2026-06-24, due 2026-06-26  
- Expected `target_mep_date` = **2026-07-28**  
- Same pattern for Reporting with `reporting_days` and `reporting_substitute_extra_days`.

### Related prior PRD

`.cursor/plans/policy-mep-reporting-cutoff-days.prd.md` documented the previous next-month-diff formula. This PRD **supersedes** that math for MEP and Reporting only.

## Codebase scan

### Required

- Prisma: `InsurancePolicy`, `CustomerPolicy`, `CustomerPolicyTrend` columns + migration/rename SQL.
- Domain: invoice insurance target MEP/reporting helpers; keep payment-term next-month diff path.
- Shared validation: backend + frontend `monthEndCutoffFields` (types, parse, form validate, pair rules, ranges).
- Customer policy service / types / meaningful-change allowlist / resolve-active / load-effective / as-of open AR terms / reporting-breach sync / trend snapshot write columns.
- Insurance entities / import policy service (headers, errors, prefill).
- Frontend: customer credit insurance form + details, policy create/edit pages, customer policy adapter, `types/Customer` + `types/db`, import `PolicyProcessor`.
- i18n EN/HE: `settings.json` field labels + validation; `import.json` field names/descriptions + error strings.

### Optional / out of scope unless needed

- Report metadata if any report exposes substitute column keys by name.
- Older planning docs under `.cursor/plans/` (leave historical; do not rewrite).
- API tests that hard-code old field names (update only if touched while implementing; do not expand coverage unless asked).

### No change needed

- Payment Term field names and next-month substitute-day math.
- Invoice columns `target_mep_date` / `target_reporting_date` schema (values change only via recompute).
- Cutoff day-of-month field names and 1–31 validation.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/mep-reporting-substitute-extra-days/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/mep-reporting-substitute-extra-days/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Backend rename, validation, and target-date math | `issues/01-backend-rename-math-validation.md` | — | 1, 2, 3, 4, 11, 12, 14, 15, 16, 18 |
| 2 | Frontend labels, forms, and import UI | `issues/02-frontend-labels-forms-import.md` | 01 | 5, 6, 7, 8, 9, 10, 17 |

**Status:** `ready-for-agent` on all slices.
