---
name: policy-mep-reporting-cutoff-days
overview: Correct month-end cutoff target MEP and target reporting date calculation so on/after-cutoff invoices use due_date + offset_days + diff (diff = calendar days from invoice_date to substitute day in the month after invoice month); before-cutoff and unset rules remain due_date + offset_days.
source: grill-me session (logic correction)
clickup_task_url: https://app.clickup.com/t/869dy84t3
isProject: false
---

# Policy MEP & Reporting Month-End Cutoff Days — Logic Correction

## Problem Statement

Credit insurance policies define **Max Allowed MEP (days)** and **Reporting days** as calendar-day offsets. Insurers also define optional **month-end cutoff** rules: when an invoice is issued on or after a cutoff day-of-month, target MEP and reporting deadlines must be extended by a computed adjustment rather than using plain `due_date + N days`.

The product already ships the four optional policy fields (`mep_cutoff_day_of_month`, `mep_substitute_day_of_month`, `reporting_cutoff_day_of_month`, `reporting_substitute_day_of_month`) on Insurance Policy and Customer Policy, with UI, validation, and propagation. **QA failed** because the implemented target-date algorithm does not match the business rule: it anchors on the substitute day in the month after the invoice month and adds offset days, instead of adding a calendar-day **diff** to the offset and computing from **due_date**.

Credit operations need the corrected formula so late-month invoices produce insurer-aligned **target MEP date** and **target reporting date** on **new** invoices, especially when `invoice_date` and `due_date` differ.

## Solution

Keep the existing schema, validation, UI, and propagation unchanged. **Replace only the central target-date calculation** used when computing invoice insurance row data.

When cutoff/substitute are configured, evaluate MEP and reporting **independently**:

1. **No adjustment** — if cutoff or substitute is null, or `invoice_date` is missing: `due_date + offset_days` (same as legacy; null if `due_date` or offset is missing).
2. **Before cutoff** — if `invoice_date` calendar day-of-month is **strictly before** the cutoff: `due_date + offset_days`.
3. **On or after cutoff** — if `invoice_date` day-of-month is **on or after** the cutoff:
   - Compute **substitute date** = substitute day-of-month in the calendar month **immediately after `invoice_date`'s month** (clamp invalid days, e.g. 31 → 30 in April).
   - Compute **diff** = full calendar-day difference from `invoice_date` to substitute date (`substitute_date − invoice_date`).
   - **Target date** = `due_date + offset_days + diff`.

MEP uses `max_allowed_mep` and the MEP cutoff/substitute pair; reporting uses `reporting_days` and the reporting pair. Null cutoff means adjustment disabled for that pair.

**Scope:** corrected math applies to **newly created invoices** (create and import). Do **not** batch-recalculate existing invoices when policy or Customer Policy month-end fields change.

## User Stories

1. As a credit operations user, I want invoices whose issue day is **before** the MEP cutoff to use `due_date + max_allowed_mep` as target MEP date, so that mid-month invoices are unaffected by month-end rules.

2. As a credit operations user, I want invoices whose issue day is **on or after** the MEP cutoff to use `due_date + max_allowed_mep + diff`, so that late-month invoices get the insurer’s extended MEP deadline.

3. As a credit operations user, I want **diff** computed as calendar days from `invoice_date` to the substitute day in the month after the invoice month, so that the extension reflects the gap between issue date and the insurer’s substitute anchor.

4. As a credit operations user, I want the final target date anchored on **due_date** (not invoice_date) when applying the on/after-cutoff adjustment, so that payment terms between issue and due are preserved in the deadline.

5. As a credit operations user, I want MEP and reporting cutoff rules evaluated **independently**, so that reporting can stay unadjusted when only MEP cutoff is configured.

6. As a credit operations user, I want substitute day 31 in a 30-day month to clamp to the last day of that month when computing the substitute date for diff, so that edge cases do not produce invalid dates.

7. As a credit operations user, I want invoices with missing `invoice_date` to fall back to `due_date + offset_days` when cutoff fields are set, so that incomplete rows still get a sensible target when possible.

8. As a credit operations user, I want target MEP and reporting dates to remain **null** when `due_date` is missing, so that incomplete invoices are not given false deadlines.

9. As a credit operations user importing or creating invoices, I want the corrected formula applied at creation time using the customer’s effective Customer Policy fields, so that all entry paths stay consistent.

10. As a credit analyst, I want month-end rule changes on Customer Policy to affect **new invoices only**, so that historical invoice deadlines are not silently rewritten.

11. As a credit dashboard user, I want reporting breach and action-window signals on new invoices to use the corrected target reporting date, so that alerts align with insurer filing deadlines.

12. As a credit dashboard user, I want MEP-related breach logic on new invoices to use the corrected target MEP date, so that exposure guard cards reflect true MEP deadlines.

13. As a credit insurance administrator, I want existing policy UI, validation, and field propagation to remain unchanged, so that this fix is limited to calculation behavior.

14. As a compliance reviewer, I want invoice target dates on new rows determined from stored Customer Policy values at creation time, so that later policy edits do not retroactively change those rows.

15. As a developer maintaining the insurance date module, I want one shared adjustment function used by target MEP and target reporting helpers, so that MEP and reporting stay aligned on the same rules.

16. As a QA engineer, I want acceptance examples with **invoice_date ≠ due_date** documented, so that the due-date anchor and diff extension are verifiable.

17. As a credit operations user, I want cutoff comparison to use the same calendar-day normalization as today’s insurance date helpers, so that behavior stays consistent across import and API paths.

18. As a developer, I want unit tests at the invoice insurance computation seam to lock the corrected behavior, so that future refactors cannot reintroduce the wrong substitute-anchor formula.

## Implementation Decisions

### What changes vs what stays

**Change:** the month-end cutoff adjustment step inside the invoice insurance date module — specifically the function that computes adjusted target dates from `due_date`, `invoice_date`, offset days, and cutoff/substitute pairs, and the helpers that call it for target MEP and target reporting.

**Unchanged:** Prisma schema columns, Insurance Policy / Customer Policy forms, server and client validation for cutoff/substitute pairs, policy-to-customer copy, import policy spreadsheet columns, effective insurance loader field list, and Customer Policy versioning allowlist.

### Target date algorithm (authoritative)

Apply separately for MEP (`max_allowed_mep`, MEP cutoff/substitute) and reporting (`reporting_days`, reporting cutoff/substitute):

```
if due_date is null OR offset_days is null → return null

if cutoff is null OR substitute is null OR invoice_date is null
  → return due_date + offset_days

invoice_day = calendar day-of-month of invoice_date (existing normalization)

if invoice_day < cutoff
  → return due_date + offset_days

substitute_date = substitute day in month immediately after invoice_date's month (clamp to month length)
diff = calendar_days(substitute_date − invoice_date)
return due_date + offset_days + diff
```

**Cutoff source:** `invoice_date` day-of-month only (not due date).

**Comparison:** before cutoff = strictly `<`; on/after = `>=`.

**Substitute month reference:** calendar month immediately after **`invoice_date`'s month** (not after raw `due_date + offset`, not after due month).

**Diff:** full inclusive calendar-day difference between the two dates (same semantics as existing `differenceInCalendarDays` usage elsewhere in the module).

**Anchor for final target:** always **`due_date`** for both paths (before and on/after cutoff). Invoice date is used only for cutoff comparison and for locating substitute month / diff; it is not the base for adding offset days in the on/after path.

**Timezone / day boundary:** keep existing `normalizeCalendarDayForInsuranceCompare` behavior for invoice day-of-month and substitute placement (no switch to a new timezone rule).

**Null behavior:** missing `invoice_date` with cutoff configured → skip adjustment, return `due_date + offset_days`. Missing `due_date` → null targets. Cutoff without substitute remains invalid at validation time (unchanged).

### Call sites

All paths that compute target dates for **new** invoice rows already funnel through `computeInvoiceInsuranceRowData` and its target MEP / target reporting helpers. Updating the shared adjustment function fixes:

- Invoice create (UI and API)
- Invoice bulk import
- Any create-time insurance row computation in the invoice service

**Do not** invoke batch target-date refresh on existing invoices when month-end fields change on Insurance Policy or Customer Policy.

**Note on refresh helpers:** batch helpers that recompute targets when `due_date` or related invoice fields change on **existing** rows may continue to call the same helpers (they will pick up corrected math for those rows when refreshed). That is not the same as policy-change backfill and is acceptable; the explicit out-of-scope item is mass recalculation triggered by policy edits alone.

### Validation and UI

No new validation rules. Existing pair validation (cutoff requires substitute, integers 1–31) remains authoritative. No layout or i18n changes unless labels need a wording tweak to match corrected behavior (optional, not required for this slice).

### Acceptance examples

| Case | invoice_date | due_date | offset | cutoff | substitute | Expected target |
|------|--------------|----------|--------|--------|------------|-----------------|
| Before cutoff | 15 Jun 2026 | 24 Jun 2026 | MEP 30 | 24 | 2 | **24 Jul 2026** (`due + 30`) |
| On cutoff, due ≠ issue | 24 Jun 2026 | 26 Jun 2026 | MEP 30 | 24 | 2 | **3 Aug 2026** (substitute 2 Jul; diff = 8; `26 Jun + 38`) |
| All cutoff null | 24 Jun 2026 | 24 Jun 2026 | MEP 30 | null | null | **24 Jul 2026** |
| Reporting independent, no reporting cutoff | 24 Jun 2026 | 26 Jun 2026 | reporting 40 | MEP cutoff only | — | Reporting **5 Aug 2026** (`due + 40`); MEP per on-cutoff row above |
| Missing invoice_date | null | 24 Jun 2026 | MEP 30 | 24 | 2 | **24 Jul 2026** (fallback) |
| Missing due_date | 24 Jun 2026 | null | MEP 30 | 24 | 2 | **null** |

Substitute clamp examples (unchanged): substitute 31 in April → 30; substitute 31 in non-leap February → 28.

**ClickUp task example note:** the original task listed MEP **2 Aug** for invoice = due = 24 Jun; the agreed formula yields **1 Aug** when dates are equal. The **due = 26 Jun** example is the authoritative acceptance case for on/after-cutoff behavior.

## Testing Decisions

### Primary test seam (single highest seam)

**Unit tests on the invoice insurance date module** — extend `tests/unit/creditInsurance/invoiceInsuranceFields.test.ts`. All create/import paths funnel through `computeInvoiceInsuranceRowData`, `computeTargetMepDate`, `computeTargetReportingDate`, and the shared month-end adjustment function.

**What makes a good test:** assert **observable calendar dates** (year/month/day) from inputs (`invoice_date`, `due_date`, offset days, cutoff/substitute pairs). Do not assert internal helper names, anchor variables, or DB persistence.

**Cases to cover:**

| Scenario | Expected behavior |
|----------|-------------------|
| All cutoff fields null | `due_date + offset_days` (regression) |
| Invoice day before cutoff | `due_date + offset_days` |
| Invoice day on cutoff (`>=`), due ≠ invoice | `due_date + offset + diff` (Jun 24 / Jun 26 example → 3 Aug MEP) |
| Invoice day after cutoff | Same on/after formula |
| MEP and reporting different cutoffs | Each pair evaluated independently |
| Substitute 31 in April / February | Substitute date clamps; diff and target derived from clamped substitute |
| Missing `invoice_date` with cutoff set | Fallback `due_date + offset_days` |
| Missing `due_date` | Null target |
| Reporting cutoff unset, MEP cutoff set | MEP adjusted; reporting `due_date + reporting_days` |

**Prior art:** existing `month-end cutoff target dates` describe block and `computeInvoiceInsuranceRowData` tests in the same file.

### Secondary seams (minimal)

- One test that `computeInvoiceInsuranceRowData` returns corrected targets end-to-end with customer cutoff fields on the customer object (integration at row level, still in the same test file).

**Avoid:** UI tests, policy form tests, and batch backfill tests for this slice.

**Do not test:** mass recalculation of existing invoices when policy month-end fields change (out of scope).

## Out of Scope

- **Backfill or batch recalculation** of target MEP/reporting dates on existing invoices when month-end fields are added or changed on Insurance Policy or Customer Policy.
- Schema, UI, validation, import columns, or policy-copy changes (already shipped).
- Country-level or Named Policy month-end fields.
- Trend snapshot tables for month-end rules.
- ClickUp issue creation — use `/to-issues` after PRD approval.

## Further Notes

### Relationship to prior implementation

An earlier implementation used **substitute day in the month after invoice month + offset_days** (equivalently anchoring on substitute rather than `due_date + offset + diff`). That formula produced **1 Aug 2026** for invoice = due = 24 Jun, MEP 30, cutoff 24, substitute 2. This PRD supersedes that algorithm everywhere target dates are computed for new invoices.

### “New invoices only”

Matches existing Customer Policy UX for reporting days. Policy or Customer Policy month-end edits affect invoices created after the change, not a historical mass update. Per-invoice refresh when due date changes on an existing row is not considered policy backfill.

### Reporting independence

Reporting uses the same algorithm with its own cutoff/substitute pair. If reporting cutoff is unset, reporting remains `due_date + reporting_days` even when MEP adjustment applies.

### Testing seam confirmation

The intended seam is **one module**: the invoice insurance date computation layer and its unit tests. No new seams across API handlers, invoice service, or sync jobs are required for this correction slice; those callers already delegate to the shared helpers.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Fix month-end cutoff target MEP and reporting date calculation | [869e0q1hc](https://app.clickup.com/t/869e0q1hc) | — | 1–18 |

**Related:** [Extend MEP & Reporting days](https://app.clickup.com/t/869dy84t3) (QA failed original), [Invoice target MEP & reporting month-end date calculation](https://app.clickup.com/t/869e08a3j) (prior implementation)

**Assignee / status:** Nilotpal Bose; Selected for Development
