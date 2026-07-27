---
name: payment-term-month-end-cutoff
overview: Add payment-term month-end cutoff/substitute fields on Insurance Policy and Customer Policy, and extend ctv_payment_term breach evaluation so on/after-cutoff invoices compare credit_days against max_payment_term + diff (parallel to MEP/reporting target-date adjustment).
source: grill-me session
clickup_task_url: null
isProject: false
---

# Payment Term Month-End Cutoff — PRD

## Problem Statement

Credit insurance policies define **Max payment term (days)** as the longest allowed calendar-day gap between invoice issue date and due date. Insurers can apply **month-end cutoff** rules for MEP and reporting deadlines; the product already stores optional cutoff/substitute pairs for those offsets and applies corrected `due_date + offset + diff` math on new invoices.

**Payment term breach** (`ctv_payment_term`) is still evaluated as a plain comparison: `credit_days > max_payment_term`, with no month-end adjustment. Late-month invoices therefore use the same cap as mid-month invoices even when insurer rules extend other term-related limits after a cutoff day.

Credit operations need payment-term breach to follow the same month-end semantics as MEP/reporting: when an invoice is issued on or after the payment-term cutoff, the effective allowed term should include the same **diff** (calendar days from `invoice_date` to the substitute day in the month after the invoice month).

## Solution

Add optional **payment-term cutoff/substitute** fields (`payment_term_cutoff_day_of_month`, `payment_term_substitute_day_of_month`) on **Insurance Policy** and **Customer Policy**, with the same validation, UI patterns, import support, and policy-to-customer propagation as existing MEP/reporting month-end fields.

Update **only** the payment-term breach evaluation (and its shared month-end diff helper) so:

1. **No adjustment** — if cutoff or substitute is null, or `invoice_date` is missing: breach when `credit_days > max_payment_term` (legacy).
2. **Before cutoff** — if invoice day-of-month is strictly before cutoff: breach when `credit_days > max_payment_term`.
3. **On or after cutoff** — breach when `credit_days > max_payment_term + diff`.

`credit_days` = calendar days from `invoice_date` to `due_date` (unchanged). `diff` uses the same substitute-month and clamping rules as MEP/reporting target dates. MEP, reporting, and payment-term cutoff pairs remain **independent**.

**Scope:** corrected breach applies to **newly created invoices** (create and import). Do **not** mass-recalculate `ctv_payment_term` on existing invoices when policy or Customer Policy payment-term month-end fields change. Per-invoice refresh when dates change on an existing row may continue to use the updated formula (not policy backfill).

## User Stories

1. As a credit insurance administrator, I want optional payment-term cutoff and substitute day-of-month fields on Insurance Policy, so that insurer month-end payment-term rules can be configured at policy level.

2. As a credit insurance administrator, I want the same payment-term cutoff fields on Customer Policy (editable and versioned), so that customer-specific overrides match MEP/reporting behavior.

3. As a credit operations user, I want invoices whose issue day is **before** the payment-term cutoff to use `credit_days > max_payment_term` for breach, so that mid-month invoices are unaffected.

4. As a credit operations user, I want invoices whose issue day is **on or after** the payment-term cutoff to compare against `max_payment_term + diff`, so that late-month invoices get the insurer’s extended allowed payment term.

5. As a credit operations user, I want **diff** computed identically to MEP/reporting (substitute day in the month after invoice month, clamped), so that all month-end rules stay consistent.

6. As a credit operations user, I want payment-term cutoff evaluated **independently** from MEP and reporting cutoffs, so that each insurer rule can be configured separately.

7. As a credit operations user, I want invoices with missing `invoice_date` to fall back to `credit_days > max_payment_term` when cutoff fields are set, so that incomplete rows still get sensible breach evaluation.

8. As a credit operations user, I want breach to remain **false** when `max_payment_term` or credit days cannot be derived, so that incomplete invoices are not falsely flagged.

9. As a credit operations user importing or creating invoices, I want the corrected breach formula applied at creation time using the customer’s effective Customer Policy fields, so that all entry paths stay consistent.

10. As a credit analyst, I want payment-term month-end edits on Customer Policy to affect **new invoices only**, so that historical breach flags are not silently rewritten.

11. As a credit dashboard user, I want terms-breach signals on new invoices to reflect the extended cap when cutoff applies, so that exposure and notification rules align with insurer rules.

12. As a credit insurance administrator, I want policy import spreadsheet columns for payment-term cutoff/substitute with prefill from policy when blank, so that bulk onboarding matches MEP/reporting import behavior.

13. As a compliance reviewer, I want breach on new rows determined from stored Customer Policy values at creation time, so that later policy edits do not retroactively change those rows.

14. As a developer maintaining the insurance date module, I want one shared month-end **diff** helper used by target-date adjustment and payment-term breach, so that rules cannot drift.

15. As a QA engineer, I want acceptance examples where cutoff **prevents** a breach that plain `max_payment_term` would flag, so that the extended cap is verifiable.

16. As a Hebrew-speaking user, I want EN and HE labels for the new fields and validation messages, so that policy and customer forms remain fully localized.

17. As a developer, I want unit tests at the invoice insurance computation seam to lock breach behavior, so that refactors cannot reintroduce plain-cap-only comparison when cutoff is set.

18. As a credit operations user, I want cutoff/substitute pair validation (1–31, cutoff requires substitute) on policy forms, customer policy save, and API/import, so that invalid configurations are rejected before invoices are created.

## Implementation Decisions

### Grilling decisions (locked)

| Decision | Choice |
|----------|--------|
| On/after-cutoff breach formula | `credit_days > max_payment_term + diff` |
| Existing invoices on policy field change | New invoices only; no mass backfill |
| Field placement | Insurance Policy + Customer Policy only |
| Field names | `payment_term_cutoff_day_of_month`, `payment_term_substitute_day_of_month` |
| Translations | EN + HE |
| Policy import | Yes; trend snapshot tables | No (same as MEP month-end) |

### Breach algorithm (authoritative)

Apply using payment-term cutoff/substitute pair and `max_payment_term`:

```
credit_days = calendar_days(due_date − invoice_date)
if credit_days is null OR max_payment_term is null → return false

if cutoff is null OR substitute is null OR invoice_date is null
  → return credit_days > max_payment_term

invoice_day = calendar day-of-month of invoice_date (existing normalization)

if invoice_day < cutoff
  → return credit_days > max_payment_term

diff = calendar_days(substitute_date − invoice_date)
  where substitute_date = substitute day in month immediately after invoice month (clamp)
return credit_days > max_payment_term + diff
```

**Comparison:** before cutoff = strictly `<`; on/after = `>=`.

**Timezone / day boundary:** reuse existing `normalizeCalendarDayForInsuranceCompare` and substitute placement (no new timezone rule).

**No new stored target date:** payment-term month-end affects `ctv_payment_term` only, not `target_mep_date` or `target_reporting_date`.

### Shared month-end diff

Extract or generalize the **diff** step already inside month-end target-date adjustment so `computePaymentTermBreach` and `applyMonthEndCutoffAdjustment` share one implementation. Target dates continue `due_date + offset + diff`; breach uses `max_payment_term + diff` as the comparison cap.

### Schema

Add to `InsurancePolicy` and `CustomerPolicy`:

- `payment_term_cutoff_day_of_month Int?`
- `payment_term_substitute_day_of_month Int?`

Ship as a safe Prisma migration SQL file (same pattern as existing month-end cutoff migration). Do **not** run `prisma migrate dev`.

### Validation module

Extend the shared month-end cutoff module to include the payment-term pair:

- Add fields to `MonthEndCutoffFields` (or rename type to reflect three pairs — prefer extending in place for minimal churn).
- Extend `parseMonthEndCutoffFields`, `validateMonthEndCutoffFormFields`, and pair validation with label `"Payment term"`.
- Reuse `DAY_OF_MONTH_MIN` / `DAY_OF_MONTH_MAX` and cutoff↔substitute pair rules.

### Propagation and effective insurance

- **Insurance Policy** create/update API: parse and persist new fields (mirror MEP/reporting handlers).
- **Customer Policy** versioning allowlist: add both new fields.
- **Policy prefill** (`getCustomerPrefillForEdit`): copy from policy-level scalars when assigning policy (not from Named or Country — those entities do not get month-end fields).
- **Policy → Customer Policy copy** on policy assignment and import prefill: include new fields.
- **`loadEffectiveInsuranceForCustomers`**: expose new fields on `InvoiceInsuranceCustomerContext`.
- **`computeInvoiceInsuranceRowData`**: pass payment-term cutoff options into `computePaymentTermBreach`.
- **`refreshPaymentTermBreachForInvoiceIds`**: pass effective cutoff fields from loaded customer context (date-refresh path picks up new math; not policy-only backfill).

### UI

Mirror existing MEP/reporting month-end inputs:

- Insurance Policy detail page and Create Policy modal (month-end section).
- Customer Credit Insurance tab (read + edit), including `CustomerDetailsCombined` save payload.
- No new styles — reuse existing month-end form layout and theme patterns.

### Import

- Add columns to policy import row type, Joi validation, `PolicyProcessor` field list and sample row, `ImportPolicyService` patch/prefill (via shared `addMonthEndFieldsToPatch` extension).
- Add EN/HE import column labels/descriptions (mirror MEP cutoff import keys).

### Translations (approved)

Add keys under existing `credit_insurance.fields` and import namespaces for EN and HE:

- `payment_term_cutoff_day_of_month`
- `payment_term_substitute_day_of_month`
- Import column label/description pairs

Reuse existing validation message keys (`cutoff_requires_substitute`, etc.) where pair errors are shared.

### Acceptance examples

| Case | invoice_date | due_date | max_payment_term | cutoff | substitute | credit_days | diff | Effective cap | Breach |
|------|--------------|----------|------------------|--------|------------|-------------|------|---------------|--------|
| Before cutoff | 15 Jun 2026 | 30 Jun 2026 | 10 | 24 | 2 | 15 | — | 10 | **true** (15 > 10) |
| On cutoff, extended cap clears breach | 24 Jun 2026 | 6 Jul 2026 | 10 | 24 | 2 | 12 | 8 | 18 | **false** (12 > 18) |
| On cutoff, still breach | 24 Jun 2026 | 20 Jul 2026 | 10 | 24 | 2 | 26 | 8 | 18 | **true** (26 > 18) |
| All cutoff null | 24 Jun 2026 | 6 Jul 2026 | 10 | null | null | 12 | — | 10 | **true** |
| Missing invoice_date | null | 30 Jun 2026 | 10 | 24 | 2 | null | — | — | **false** |
| Missing max_payment_term | 24 Jun 2026 | 30 Jun 2026 | null | 24 | 2 | 6 | — | — | **false** |
| MEP cutoff only | 24 Jun 2026 | 6 Jul 2026 | 10 | MEP cutoff set | — | 12 | — | 10 (payment term unset) | **true** |

Substitute clamp: substitute 31 in April → 30; in non-leap February → 28 (diff derived from clamped substitute).

## Codebase scan

### Required

| Area | Reason |
|------|--------|
| `prisma/schema.prisma` + migration SQL | New columns on InsurancePolicy, CustomerPolicy |
| `shared/creditInsurance/monthEndCutoffFields.ts` | Validation, parsing, form helpers for third pair |
| `server/services/creditInsurance/invoiceInsuranceFields.ts` | Shared diff + `computePaymentTermBreach` + `computeInvoiceInsuranceRowData` |
| `server/services/creditInsurance/loadEffectiveInsuranceForCustomers.ts` | Load new fields for invoice/breach paths |
| `server/services/creditInsurance/customerPolicyTypes.ts` | Row mapping and write input types |
| `server/services/creditInsurance/hasMeaningfulCustomerPolicyFieldChange.ts` | Versioning allowlist + numeric equality |
| `server/services/creditInsurance/CustomerPolicyService.ts` | Patch/save new fields |
| `server/services/creditInsurance/resolveActiveCustomerPolicy.ts` | Prisma select includes new fields |
| `server/services/InsurancePolicyService.ts` | Prefill return type and policy select |
| `pages/api/entities/insurancePolicyHandlers.ts` | Policy API parse/persist |
| `pages/api/entities/handlers/customers.ts` | Customer policy month-end patch |
| `pages/api/import/policy/index.ts` | Joi schema for import columns |
| `server/services/import/ImportPolicyService.ts` | Import row type and patch |
| Policy UI (`credit-insurance-policies/[policyId]/page.tsx`, `CreateInsurancePolicyModal.tsx`) | Form fields and validation |
| Customer UI (`CustomerCreditInsuranceInfo.tsx`, `CustomerDetailsCombined.tsx`) | Display and edit |
| `app/[locale]/app/import/policy/PolicyProcessor.tsx` | Import column list |
| `shared/customerPolicyAdapter.ts`, `types/Customer.ts` | Client types |
| `locales/en/settings.json`, `locales/he/settings.json`, `locales/en/import.json`, `locales/he/import.json` | Labels (approved) |
| `tests/unit/creditInsurance/invoiceInsuranceFields.test.ts` | Breach + diff tests |
| `tests/unit/creditInsurance/monthEndCutoffFields.test.ts` | Validation tests for third pair |
| `tests/unit/creditInsurance/hasMeaningfulCustomerPolicyFieldChange.test.ts` | Allowlist coverage |
| `server/services/creditInsurance/syncInvoiceReportingBreach.ts` | `refreshPaymentTermBreachForInvoiceIds` must pass cutoff context |

### Optional / out of scope

| Area | Reason |
|------|--------|
| `InsurancePolicyTrend`, `CustomerPolicyTrend`, `NamedPolicyTrend`, country trend tables | Explicitly out of scope per grilling |
| `NamedPolicy`, `InsurancePolicyCountry` | No month-end fields on these entities |
| `reportMetadata.ts` / report builder | No new invoice columns; `ctv_payment_term` already exposed |
| Dashboard KPI SQL | Reads stored `ctv_payment_term`; no query change needed |
| Batch backfill job on policy edit | Out of scope |

### No change needed

| Area | Reason |
|------|--------|
| `target_mep_date` / `target_reporting_date` computation | Unaffected; separate cutoff pairs |
| `pages/api/invoices/update-last-payment-date.ts` | Recalculates MEP/reporting targets from payment date, not payment-term breach |
| `NotificationRuleEvaluator` | Consumes persisted `ctv_payment_term`; no rule change |
| Invoice grid column definitions | `ctv_payment_term` field already exists |

## Testing Decisions

### Primary test seam (single highest seam)

**Unit tests on the invoice insurance date module** — extend `tests/unit/creditInsurance/invoiceInsuranceFields.test.ts`.

**What makes a good test:** assert **observable breach boolean** and, where helpful, boundary cases with concrete calendar dates. Do not assert internal helper names.

**Cases to cover:**

| Scenario | Expected behavior |
|----------|-------------------|
| All payment-term cutoff fields null | `credit_days > max_payment_term` (regression) |
| Invoice day before cutoff | Plain cap comparison |
| On/after cutoff, extended cap prevents breach | e.g. 12 credit days, cap 10, diff 8 → false |
| On/after cutoff, still breaches | e.g. 26 credit days, cap 10, diff 8 → true |
| Missing `invoice_date` with cutoff set | Fallback plain comparison (or false if credit_days null) |
| Missing `max_payment_term` | false |
| Payment-term cutoff unset, MEP cutoff set | Breach uses plain cap only |
| Substitute clamp affects diff | April/February clamp cases |
| `computeInvoiceInsuranceRowData` end-to-end | Returns corrected `ctv_payment_term` with customer cutoff fields |

**Secondary:** extend `monthEndCutoffFields.test.ts` for payment-term pair validation; `hasMeaningfulCustomerPolicyFieldChange.test.ts` for allowlist.

**Avoid:** UI e2e, trend snapshot tests, mass backfill tests.

## Out of Scope

- Backfill or batch recalculation of `ctv_payment_term` when payment-term month-end fields change on policy or Customer Policy.
- Month-end fields on Named Policy or Insurance Policy Country.
- Trend/history snapshot columns for payment-term cutoff.
- New persisted “target payment term date” column.
- ClickUp issue creation in this step — run **`/to-issues`** after PRD approval.

## Further Notes

### Relationship to MEP/reporting month-end PRD

`.cursor/plans/policy-mep-reporting-cutoff-days.prd.md` corrected **target date** math (`due_date + offset + diff`). This PRD applies the **same diff** to **payment-term breach cap** (`max_payment_term + diff`). Implementations should share diff computation to prevent divergence.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Payment Term Month-End Cutoff](https://app.clickup.com/t/869e0rk6r)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Schema and shared validation for payment-term month-end fields | [869e0rkep](https://app.clickup.com/t/869e0rkep) | — | 18 |
| 2 | Policy and customer policy persistence for payment-term cutoff | [869e0rkkm](https://app.clickup.com/t/869e0rkkm) | 1 | 1–2, 9, 12, 18 |
| 3 | Payment-term breach calculation with month-end diff | [869e0rkp8](https://app.clickup.com/t/869e0rkp8) | 2 | 3–11, 13–15, 17 |
| 4 | UI, policy import, and i18n for payment-term month-end fields | [869e0rktb](https://app.clickup.com/t/869e0rktb) | 2 | 1–2, 12, 16, 18 |

**Related:** [Fix month-end cutoff target MEP and reporting date calculation](https://app.clickup.com/t/869e0q1hc)

**Assignee / status:** Nilotpal Bose; Selected for Development

### “New invoices only”

Matches MEP/reporting month-end behavior. Policy or Customer Policy payment-term cutoff edits affect invoices created after the change. `refreshPaymentTermBreachForInvoiceIds` when invoice dates change is acceptable; mass update triggered only by policy field edits is not.
