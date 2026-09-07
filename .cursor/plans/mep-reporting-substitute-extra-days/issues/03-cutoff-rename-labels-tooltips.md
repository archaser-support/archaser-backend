# 03 — Cutoff rename + MEP/Reporting labels and tooltips

**Status:** done
**Priority:** normal
**Blocked by:** [01-backend-rename-math-validation](01-backend-rename-math-validation.md), [02-frontend-labels-forms-import](02-frontend-labels-forms-import.md)
**User stories:** 7, 10, 11, 12, 14, 15, 16
**PRD:** `.cursor/plans/mep-reporting-substitute-extra-days.prd.md`

## What to build

Rename the remaining month-end day-of-month columns (meaning and math unchanged) across Insurance Policy, Customer Policy, Customer Policy Trend, APIs, domain loaders, prefill, and policy import:

- `mep_cutoff_day_of_month` → `mep_cutoff_day`
- `reporting_cutoff_day_of_month` → `reporting_cutoff_day`
- `payment_term_cutoff_day_of_month` → `payment_term_cutoff_day`
- `payment_term_substitute_day_of_month` → `payment_term_substitute_day`

Preserve stored numeric values. Keep cutoff and Payment Term substitute validation at 1–31 and Payment Term next-month-day formula. Policy import accepts only the new headers and rejects the legacy `*_day_of_month` names for these four fields (same hard-rename pattern as substitute extra-days).

On customer Policies tab and Insurance Policy create/edit only: short MEP/Reporting labels (“MEP Cutoff Day”, “MEP Extra Days”, “Reporting Cutoff Day”, “Reporting Extra Days”) with matching Hebrew; info-icon tooltips (`placement="bottom"`) using the PRD formula copy (EN + HE). Payment Term **visible** labels stay “…Day of Month”. Do not add Payment Term tooltips. Do not change view-mode hide-empty-pair behavior. Import catalog must use the new header keys; tooltip polish on import UI is out of scope.

## Acceptance criteria

- [x] Four columns renamed in schema/API/domain/import with values preserved
- [x] Payment Term formula and 1–31 day validation unchanged; MEP/Reporting extra-days math unchanged
- [x] Import accepts new headers only and rejects legacy `*_day_of_month` for these four fields
- [x] Customer + policy forms read/write the new keys
- [x] MEP/Reporting short EN+HE labels and info-icon tooltips match the PRD wording
- [x] Payment Term UI labels still say “…Day of Month”; no Payment Term tooltips added

## How to test

1. Apply the rename SQL locally; confirm existing Customer Policy / Insurance Policy rows keep the same numbers under `mep_cutoff_day`, `reporting_cutoff_day`, `payment_term_cutoff_day`, and `payment_term_substitute_day`.
2. Open a credit-insurance customer Policies tab in Edit: confirm MEP/Reporting short labels, info icons with the formula tooltips, and Payment Term labels still “…Day of Month”. Save a valid pair and confirm values persist under the new keys.
3. Open Insurance Policy create/edit; confirm the same labels/tooltips/keys.
4. In view mode with Reporting unset: Reporting cutoff/extra fields stay hidden; Edit still shows empty inputs.
5. Import a policy row with the new cutoff/PT headers; confirm success. Retry with old `*_cutoff_day_of_month` / `payment_term_substitute_day_of_month` headers and confirm failure.
6. Smoke-check an on/after-cutoff invoice still uses `due + offset + extra days` for MEP/Reporting, and Payment Term breach still uses the next-month day gap.
