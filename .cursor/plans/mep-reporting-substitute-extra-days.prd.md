---
name: mep-reporting-substitute-extra-days
overview: MEP/Reporting targets use extra calendar days when cutoff applies; rename month-end schema keys for clarity; shorten MEP/Reporting UI labels with info tooltips; Payment Term math stays next-month day-of-month; Insurance Policy term edits version-push to active Customer Policies.
source: grill-me session (/start-work + follow-up grill on policy fields + policy→customer propagation grill)
clickup_task_url: https://app.clickup.com/t/869exp85r
isProject: false
---

# MEP / Reporting Substitute Extra Days

## Problem Statement

Credit operations configure optional month-end rules on insurance policies and customer policies. Insurers now treat the MEP/Reporting “substitute” value as **extra calendar days** added to the original target (`due_date + offset`), not as a day-of-month in the next calendar month. Field names and labels that still say “day of month” mislead admins and capped substitutes at 1–31.

Cutoff and Payment Term substitute columns still use long `*_day_of_month` names even though they remain day-of-month semantics. Ops also need shorter MEP/Reporting labels and clear tooltips that explain when extra days apply.

Payment Term month-end must keep today’s **next-month day-of-month gap** behavior (not extra days). Empty month-end pairs stay hidden in customer view mode. Existing stored substitute numbers are not remapped. When an Insurance Policy’s shared term fields change, active Customer Policies on that policy must get a new version row with the updated values (named/country/customer overrides of those pushed fields are overwritten).

## Solution

1. **MEP / Reporting target math** (when both cutoff and substitute-extra-days are set, and invoice day-of-month is on or after cutoff):
   - Original target = `due_date + offset_days` (MEP = `max_allowed_mep`; Reporting = `reporting_days`).
   - Final target = original target **plus** substitute as calendar days.
   - Before cutoff, or if either field of the pair is unset: `due_date + offset_days` only.
2. **Schema / API / import renames** (preserve numeric values) — **done**:
   - `mep_substitute_day_of_month` → `mep_substitute_extra_days`; `reporting_substitute_day_of_month` → `reporting_substitute_extra_days` (validate **1–365**).
   - `mep_cutoff_day_of_month` → `mep_cutoff_day`; `reporting_cutoff_day_of_month` → `reporting_cutoff_day`; `payment_term_cutoff_day_of_month` → `payment_term_cutoff_day`; `payment_term_substitute_day_of_month` → `payment_term_substitute_day` (still **1–31**; Payment Term math unchanged).
3. **Policy import:** hard rename — new headers only; reject legacy `*_day_of_month` headers for these fields (no aliases).
4. **UI (customer Policies tab + Insurance Policy create/edit only):**
   - Short EN labels: “MEP Cutoff Day”, “MEP Extra Days”, “Reporting Cutoff Day”, “Reporting Extra Days” (HE updated to match).
   - Info-icon tooltips (`placement="bottom"`) with plain formula copy (EN + HE).
   - Payment Term **visible labels** stay “…Day of Month” wording even after schema rename; no Payment Term tooltips in this feature.
   - View mode continues to **hide** empty month-end pairs; Edit always shows inputs.
5. **Payment Term** cutoff/substitute: next-month day-of-month formula unchanged.
6. **No remapping** of existing stored numbers; meaning of MEP/Reporting substitute flips to extra days on next recompute.
7. **Insurance Policy → Customer Policy push (remaining):** when shared term fields on the master policy change, version each **active** Customer Policy on that policy (close old / open new), overlaying the policy values for the pushed field set; keep customer-only fields (approved limit, limit type, exclusions, etc.). Do **not** recalculate existing invoice `target_mep_date` / `target_reporting_date` as part of this push. No UI confirm dialog (silent like today’s cost % behavior, but via versioning).
8. **No tenant-wide invoice target backfill** in product scope. Optional ops refresh (targets only) for account **10149** customers that have a MEP/Reporting pair, open Due/Overdue invoices only — already run once locally after the math change.

## User Stories

1. As a credit operations user, I want late-month invoices (on/after MEP cutoff) to get `due_date + max_allowed_mep + mep_substitute_extra_days` as target MEP date, so that deadlines match the insurer’s extra-days rule.
2. As a credit operations user, I want invoices issued before the MEP cutoff to keep `due_date + max_allowed_mep`, so that mid-month invoices are unaffected.
3. As a credit operations user, I want the same extra-days rule for Reporting when the reporting pair is set, so that filing deadlines stay consistent with MEP-style rules.
4. As a credit operations user, I want Payment Term substitute to keep the old next-month-day adjustment, so that payment-term breach logic does not change in this release.
5. As a credit operations user, I want Reporting to stay independent of MEP (unset reporting pair means no reporting extra days), so that incomplete reporting config does not invent extensions.
6. As a credit insurance administrator, I want MEP/Reporting substitute fields stored and labeled as extra days (1–365), so that longer extensions are allowed and names match meaning.
7. As a credit insurance administrator, I want cutoff and Payment Term substitute columns named without the long `_day_of_month` suffix in schema/API/import, so that keys stay readable.
8. As a credit insurance administrator, I want cutoff and substitute to remain a required pair, so that incomplete month-end config cannot be saved.
9. As a credit insurance administrator, I want clearing the cutoff to clear the substitute, so that pairs stay consistent in the UI.
10. As a credit insurance administrator, I want short MEP/Reporting labels plus info-icon tooltips on customer and policy forms, so that I understand when extra days apply without reading a PRD.
11. As a Hebrew-speaking administrator, I want matching HE labels and tooltips for those MEP/Reporting fields, so that the UI is usable in both languages.
12. As a credit insurance administrator, I want Payment Term field labels to keep “…Day of Month” wording, so that Payment Term still reads as a calendar day rule in the UI.
13. As a credit insurance administrator, I want empty month-end pairs hidden in view mode, so that the Policies layout stays uncluttered when a rule is off.
14. As a policy importer, I want CSV columns using the new field names only, so that imports match the API.
15. As a policy importer, I want old `*_day_of_month` headers for these month-end fields to fail clearly, so that stale templates are not silently accepted.
16. As a developer, I want schema columns renamed on Insurance Policy, Customer Policy, and Customer Policy Trend, so that storage matches the new keys.
17. As a developer, I want MEP/Reporting target helpers to add extra days while Payment Term still uses the next-month diff helper, so that the two behaviors can coexist safely.
18. As a developer, I want customer-prefill to keep copying month-end fields from Insurance Policy onto Customer Policy at assign/import time, so that defaults remain available when first assigning.
19. As a product owner, I want Insurance Policy edits of shared term fields to overwrite those fields on all active Customer Policies (via version rows), so that master policy is the source of truth for those terms.
19a. As a product owner, I want named/country-resolved terms on the customer (`max_payment_term` / `max_allowed_mep` / `reporting_days`) overwritten by the policy defaults when the master policy is saved, so that one rule applies to every active customer on that policy.
19b. As a product owner, I want invoice target dates left unchanged by the policy→customer push, so that historical invoice deadlines are not rewritten until a later refresh path.
19c. As a developer, I want the push to create a new Customer Policy version only when a pushed field differs, freeze the old row, and run the same post-save sync as the customer Policies tab, so that history and side effects match customer-screen edits.
19d. As a developer, I want cost % and registration fee to use that same version-if-changed path (replacing in-place `updateMany`), so that all pushed policy fields share one mechanism.
19e. As a developer, I want a failed mid-push to fail the whole policy save and roll back, so that no customer is left half-updated.
19f. As a credit insurance administrator, I do not want an extra confirm dialog when saving the policy, so that save stays as simple as today.
20. As a product owner, I want existing stored substitute numbers left as-is without remapping, so that we avoid guessing old→new conversions.
21. As a credit analyst, I want natural refreshes (and customer policy edits that already sync insurance fields) to recompute targets with the new formula, so that refreshed rows stay correct going forward.
22. As a credit analyst, I do not want a silent all-tenant rewrite of invoice targets in this feature, so that historical rows are not mass-changed without an explicit ops job.
23. As an ops engineer on frozen account 10149, I want a targets-only refresh for customers that have a MEP/Reporting pair and open invoices, so that that account can catch up despite cron skips.
24. As a QA engineer, I want a concrete acceptance example (invoice on cutoff day, known due, offset, extra days), so that target dates are easy to verify.
25. As a compliance reviewer, I want API and import validation to reject out-of-range values (extra days outside 1–365; day fields outside 1–31), so that invalid config cannot be saved.

## Implementation Decisions

### Delivery status

- **Done (slices 01–03):** MEP/Reporting substitute rename to `*_substitute_extra_days`, validation 1–365, target math change, Payment Term formula unchanged, frontend forms/import wired, cutoff + Payment Term substitute schema/API/import renames, short MEP/Reporting labels + info tooltips (EN+HE).
- **Remaining (slice 04):** Insurance Policy save pushes shared term fields to active Customer Policies via version-if-changed (see Prefill / propagation). Related bugfix on the MEP branch: coerce policy `start_date` / `end_date` YYYY-MM-DD to UTC midnight `Date` before Prisma write (same pattern as `invoice_date` / `customers.parseDateOnly`).

### Formula (MEP and Reporting only)

When cutoff and substitute-extra-days are both set and `invoice_date` day-of-month ≥ cutoff:

`target = due_date + offset_days + substitute_extra_days`

Otherwise (missing pair, missing invoice date for the gate, or day before cutoff):

`target = due_date + offset_days`

(Null when `due_date` or offset is missing — same as today.)

Example: due 26 Jun, `max_allowed_mep` 30, substitute extra days 2, invoice on/after cutoff → target MEP **28 Jul** (26 Jun + 30 + 2).

### Payment Term

Keep next-month substitute-day logic for payment-term breach (`ctv_payment_term`) only. Rename column to `payment_term_substitute_day` and cutoffs to `*_cutoff_day` without changing meaning or 1–31 validation.

### Schema / API rename (done in 01–03)

| Old | New |
|-----|-----|
| `mep_cutoff_day_of_month` | `mep_cutoff_day` |
| `reporting_cutoff_day_of_month` | `reporting_cutoff_day` |
| `payment_term_cutoff_day_of_month` | `payment_term_cutoff_day` |
| `payment_term_substitute_day_of_month` | `payment_term_substitute_day` |

Tables: `InsurancePolicy`, `CustomerPolicy`, `CustomerPolicyTrend`. Safe SQL rename migration (preserve values). Wire all loaders, APIs, prefill, trend SQL, import, and frontend types/forms.

### Validation

- Cutoff fields and Payment Term substitute: still 1–31.
- MEP / Reporting substitute extra days: 1–365.
- Pair rules unchanged for all three pairs.

### UI / i18n (done in 03)

Surfaces: customer Policies tab + Insurance Policy create/edit (not policy import catalog for tooltips; import still must accept new header keys).

EN labels:

- MEP Cutoff Day
- MEP Extra Days
- Reporting Cutoff Day
- Reporting Extra Days

EN tooltips (info icon next to label, `placement="bottom"`):

- MEP Cutoff Day: Invoice issue day on/after this day uses MEP extra days.
- MEP Extra Days: Added to due date + max allowed MEP when cutoff applies.
- Reporting Cutoff Day: Invoice issue day on/after this day uses reporting extra days.
- Reporting Extra Days: Added to due date + reporting days when cutoff applies.

HE labels and tooltips updated to match (permission granted by this PRD for these keys only). Reuse existing MUI Tooltip / info-icon patterns; no new style system.

Payment Term labels remain “…Day of Month” in the UI. Empty pairs stay hidden in view mode.

### Prefill / propagation

**Assign / import prefill (unchanged):** month-end and related term fields still copy from Insurance Policy → Customer Policy when assigning or importing.

**Master policy edit → active customers (new — grill 2026-09-07):**

On successful Insurance Policy update, for each **active** Customer Policy linked to that policy:

1. Compare the **pushed field set** to the customer’s current row.
2. If any pushed field differs: freeze gap on the old row, deactivate it, create a new active version that keeps customer-only fields (`approved_limit`, expiration, `limit_type`, exclusions, etc.) and overlays the policy values for the pushed set; then run the same post-save sync as the customer Policies tab (`syncCustomerInsuranceFields` + capacity gap).
3. If nothing in the pushed set differs: no-op for that customer (no history row).
4. Do **not** recalculate invoice `target_mep_date` / `target_reporting_date`.
5. No UI confirm dialog.
6. Failure mid-push fails the whole policy save (roll back); spike at implement time to keep post-save sync transactional or define compensating behavior so “all or nothing” is real.

**Pushed field set:**

- `mep_cutoff_day`, `mep_substitute_extra_days`
- `reporting_cutoff_day`, `reporting_substitute_extra_days`
- `payment_term_cutoff_day`, `payment_term_substitute_day`
- `max_allowed_mep`, `reporting_days`, `max_payment_term`
- `cost_percent`, `registration_fee_percent` (move off in-place `updateMany` into this path)

**Named / country:** policy defaults overwrite whatever is stored on the customer for those pushed fields (including values that originally came from named/country resolve at assign).

### Refresh / backfill

- No productized all-tenant invoice target rewrite.
- Account **10149** ops refresh (targets only; customers with MEP/Reporting pair; Due/Overdue only) was run once locally after the math change; not required as a shipped job unless ops asks again.

### Testing seam

Prefer existing pure helpers that compute target MEP / target reporting dates and payment-term breach in the credit-insurance domain module — highest seam with prior art. Also month-end field validation and import header acceptance. Do not require new automated tests unless explicitly requested; manual How to test on slices is enough for delivery.

## Testing Decisions

- Good tests assert **external outcomes** (given invoice date, due date, offsets, cutoff, substitute → expected target dates / breach flags; import accepts new headers and rejects legacy names), not internal helper names.
- Modules under test if later requested: invoice insurance target-date helpers; month-end field validation (range + pairing); import policy column mapping for renamed keys.
- Prior art: `api/test/invoice-insurance-negative-amount.test.ts`, `api/test/import-policy.service.test.ts`, shared frontend/backend `monthEndCutoffFields` validators.
- Manual QA remains the default delivery bar unless the user asks for automated tests.

## Out of Scope

- Changing Payment Term substitute **formula** (still next-month day gap).
- Remapping or clearing existing stored substitute / cutoff numeric values.
- Import aliases for old CSV headers.
- Policy import UI tooltips / import catalog copy refresh beyond header key alignment needed for hard rename.
- Payment Term info tooltips.
- Showing empty month-end pairs in customer view mode.
- Recalculating invoice `target_mep_date` / `target_reporting_date` as part of the policy→customer push.
- UI confirm dialog before policy save when customers will be versioned.
- Preserving named/country/customer overrides of the pushed field set when the master policy changes.
- Tenant-wide one-off rewrite of invoice `target_mep_date` / `target_reporting_date`.
- Customer-level overdue MEP KPI formula changes beyond existing consumers of invoice target dates.
- New automated test suites (unless later explicitly requested).
- New visual styles beyond wiring existing Tooltip / info-icon patterns.

## Further Notes

### Acceptance example

- Cutoff 24, `mep_substitute_extra_days` 2, `max_allowed_mep` 30
- Invoice 2026-06-24, due 2026-06-26
- Expected `target_mep_date` = **2026-07-28**
- Same pattern for Reporting with `reporting_days` and `reporting_substitute_extra_days` when that pair is set

### Related prior PRD

`.cursor/plans/policy-mep-reporting-cutoff-days.prd.md` documented the previous next-month-diff formula. This PRD supersedes that math for MEP and Reporting only.

### Grill decision log (follow-up — labels / rename)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Payment Term math | Keep next-month day-of-month |
| D2 | Old substitute numbers | Leave as-is — no remapping |
| D3 | Master policy → customers | **Superseded** by propagation grill below (was: leave copies alone) |
| D4–D9 | 10149 refresh | Targets only; pair customers; open invoices; ran locally |
| D10 | Empty view fields | Keep hiding |
| D11–D16 | MEP/Reporting labels + tooltips | Short names; formula tooltips; info icon; EN+HE; customer + policy forms |
| D17–D19 | Cutoff + PT substitute rename | Schema/API only; names `*_cutoff_day` / `payment_term_substitute_day`; hard import rename |
| D20 | Shipping | One follow-up slice for rename + labels/tooltips (done as 03) |
| D21 | Payment Term UI labels | Keep “…Day of Month” wording |

### Grill decision log (policy → customer propagation — 2026-09-07)

| # | Topic | Decision |
|---|-------|----------|
| P1 | Policy edit → customers | Overwrite all **active** customers on that policy |
| P2 | Invoice target dates | Do **not** recalculate as part of the push |
| P3 | Fields to push | Month-end pairs + payment-term pair + `max_allowed_mep` + `reporting_days` + `max_payment_term` (+ cost/fee via P8) |
| P4 | Named / country terms | Overwrite with policy defaults for everyone |
| P5 | When to run | Every successful policy save (gated by P7) |
| P6 | History | New customer-policy version row (close old / open new) |
| P7 | No-op skip | Version only if a pushed field differs for that customer |
| P8 | Cost % / registration fee | Same version-if-changed path (replace in-place `updateMany`) |
| P9 | Side effects | Freeze old row + same post-save sync as customer-screen versioning |
| P10 | Failure | Fail whole policy save / roll back (no partial push) |
| P11 | UI | No confirm dialog — silent save |
| P12 | Shared understanding | Locked |

Assumptions from codebase (not grilled): new version **keeps** customer-only fields (`approved_limit`, expiration, `limit_type`, exclusions, etc.) and only overlays the pushed policy fields.

## Codebase scan

### Required (remaining — slice 04 propagation)

- `api/src/credit-insurance/insurance-entities.service.ts` — replace `customerPolicy.updateMany` cost/fee sync with version-if-changed push; coerce `start_date`/`end_date` via `parseDateOnly` on create/update.
- Reuse customer versioning patterns from `api/src/customers/customer-policy.service.ts` (`freezeCustomerPolicyGapOnDeactivation`, deactivate + create, `runPostSaveSync` / `syncCustomerInsuranceFields` + `ensureCustomerCapacityGapStored`).
- `hasMeaningfulCustomerPolicyFieldChange` (or a push-specific field diff) for the pushed field set only.
- Bulk reassign path in the same service that still only copies cost/fee — align or document if out of scope for 04.

### Required (done — slices 01–03)

- Prisma schema + SQL rename for month-end keys on Insurance Policy, Customer Policy, Customer Policy Trend.
- Backend + frontend `monthEndCutoffFields`, customer policy service/types, meaningful-change allowlist, resolve-active / load-effective / as-of / trend / sync / insurance prefill / import policy.
- Frontend: customer credit insurance form + policy create/edit (keys, short MEP/Reporting labels, info tooltips); adapter + `types/Customer` + `types/db`.
- i18n EN/HE `settings.json` for labels + tooltip keys.
- Import processor field keys / legacy rejection lists.

### Optional / out of scope unless needed

- Report metadata if any report exposes month-end column keys by name.
- Import.json description polish beyond hard rename.
- Expanding Payment Term tooltips.
- UI banner/count of customers versioned on policy save.
- Productized invoice target refresh after policy term push.

### No change needed

- Payment Term next-month substitute math.
- Invoice `target_mep_date` / `target_reporting_date` schema columns.
- MEP/Reporting substitute extra-days math and 1–365 validation (already delivered).
- View-mode hide-empty-pair behavior.
- Frontend policy save UI (no confirm dialog per P11).

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/mep-reporting-substitute-extra-days/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/mep-reporting-substitute-extra-days/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Backend rename, validation, and target-date math | `issues/01-backend-rename-math-validation.md` | — | 1, 2, 3, 4, 11, 12, 14, 15, 16, 18 |
| 2 | Frontend labels, forms, and import UI | `issues/02-frontend-labels-forms-import.md` | 01 | 5, 6, 7, 8, 9, 10, 17 |
| 3 | Cutoff rename + MEP/Reporting labels and tooltips | `issues/03-cutoff-rename-labels-tooltips.md` | 01, 02 | 7, 10, 11, 12, 14, 15, 16 |
| 4 | Policy save → version-push terms to active customers | `issues/04-policy-push-customer-versions.md` | 01–03 | 19, 19a–19f |

**Status:** `01`–`03` done; `04` ready-for-agent.
