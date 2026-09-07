# 04 — Policy save → version-push terms to active customers

**Status:** done
**Priority:** high
**Blocked by:** [01-backend-rename-math-validation](01-backend-rename-math-validation.md), [02-frontend-labels-forms-import](02-frontend-labels-forms-import.md), [03-cutoff-rename-labels-tooltips](03-cutoff-rename-labels-tooltips.md)
**User stories:** 19, 19a, 19b, 19c, 19d, 19e, 19f
**PRD:** `.cursor/plans/mep-reporting-substitute-extra-days.prd.md`

## What to build

Replace the Insurance Policy update path that only `updateMany`s `cost_percent` / `registration_fee_percent` on active Customer Policies. On policy save, for each **active** Customer Policy on that policy:

- Diff the **pushed field set** against the customer row.
- If any pushed field differs: freeze gap on the old row, deactivate it, create a new active version that keeps customer-only fields and overlays policy values for the pushed set; run the same post-save sync as the customer Policies tab.
- If nothing differs: skip that customer (no history row).
- Do **not** recalculate invoice `target_mep_date` / `target_reporting_date`.
- No UI confirm dialog.
- Fail the whole policy save / roll back on mid-push failure (spike: keep sync inside the transaction or define compensating behavior).

**Pushed fields:** `mep_cutoff_day`, `mep_substitute_extra_days`, `reporting_cutoff_day`, `reporting_substitute_extra_days`, `payment_term_cutoff_day`, `payment_term_substitute_day`, `max_allowed_mep`, `reporting_days`, `max_payment_term`, `cost_percent`, `registration_fee_percent`.

Named/country values stored on the customer for those fields are overwritten by policy defaults.

Also include the related policy date fix if not already on the MEP branch: coerce `start_date` / `end_date` YYYY-MM-DD to UTC midnight `Date` before Prisma create/update (same pattern as invoice date / `customers.parseDateOnly`).

## Acceptance criteria

- [x] Changing any pushed field on the Insurance Policy versions every active Customer Policy whose row differs
- [x] Unchanged pushed fields → no new customer-policy version
- [x] Customer-only fields (approved limit, limit type, exclusions, etc.) preserved on the new version
- [x] Cost % / registration fee use the same version path (no leftover in-place-only sync for those on policy update)
- [x] Invoice target dates unchanged by the push
- [x] Failed push fails the policy save (no partial customer updates)
- [x] No new confirm dialog in the policy UI
- [x] Policy create/update accepts YYYY-MM-DD `start_date` / `end_date` without Prisma DateTime errors

## How to test

1. Open an Insurance Policy with at least two active customers. Note each customer’s MEP cutoff / extra days / reporting pair / max MEP / reporting days / payment term / cost %.
2. Change Reporting Extra Days on the policy and save. Expect each active customer to show a new active Customer Policy version with the new value; old row inactive; approved limit unchanged.
3. Save the policy again with no term changes (e.g. touch insurer name only). Expect no new customer-policy versions.
4. Confirm open invoice `target_mep_date` / `target_reporting_date` did not change from step 2 alone.
5. Confirm a customer that had a named-policy-specific `max_allowed_mep` now shows the policy default after a policy MEP change.
6. Smoke: edit policy start/end dates and save — expect success (no “Could not save policy” / Prisma ISO DateTime error).
