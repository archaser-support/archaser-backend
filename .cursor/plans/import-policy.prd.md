---
name: import-policy
overview: Add a Policy tab to the import page so credit-insurance accounts can bulk-assign or update CustomerPolicy rows for existing customers, with required policy/customer/limit-type fields, policy-driven defaults for blank optionals, and strict Named validation.
source: grill-me session
clickup_task_url: https://app.clickup.com/t/869dw47dg
isProject: false
---

# Import Policy — CustomerPolicy Bulk Assignment

## Problem Statement

Credit-insurance accounts need to assign or update insurance policy settings for many customers at once. Today, policy fields can be passed through the **customer import API** but are not exposed in the customer import UI, and that path still uses legacy customer-column writes rather than the supported **CustomerPolicy** assignment flow.

Operations teams must either edit customers one-by-one in the UI or rely on undocumented API behavior. There is no dedicated import experience with clear required fields, Named vs DCL rules, or the same default-resolution behavior users get when assigning a policy manually.

## Solution

Add a **Policy** tab on the import page (file upload only for MVP) that imports **CustomerPolicy assignments** for **existing customers**:

- **Required columns:** `policy_number`, `customer_number`, `limit_type`
- **Conditionally required:** when `limit_type` is **Named**, a resolvable **NamedPolicy** row must exist (strict — row fails otherwise)
- **Optional columns:** standard credit-insurance fields; when blank, values are resolved from the policy prefill chain (NamedPolicy → InsurancePolicyCountry for the customer's country → InsurancePolicy scalars)
- **Upsert behavior:** patch the active row when the policy is unchanged; switch policy (deactivate old, create new active row) when `policy_number` changes; create when no active policy exists
- **Access:** new `import_policy` permission; tab visible only when the account has credit insurance enabled
- **Cleanup:** remove policy fields from customer import — the Policy tab becomes the only supported path for bulk policy assignment

## User Stories

1. As an operations user on a credit-insurance account, I want a **Policy** tab on the import page, so that I can bulk-assign policies without editing each customer manually.

2. As an operations user, I want to upload a spreadsheet with **policy number**, **customer number**, and **limit type**, so that the minimum data needed for assignment is clear.

3. As an operations user, I want import to **fail** when the customer number does not exist, so that I do not accidentally create partial or orphan records.

4. As an operations user, I want import to **fail** when the policy number does not match an **active primary** policy on my account, so that invalid assignments are caught early.

5. As an operations user importing **Named** limit type, I want the row to **fail** when no matching **NamedPolicy** row exists on that policy, so that Named assignments stay aligned with policy configuration.

6. As an operations user importing **Named** limit type, I want NamedPolicy lookup to try **policy customer number** first and then **main customer number**, so that behavior matches the customer UI.

7. As an operations user, I want blank optional columns to be filled from **policy country defaults** when my customer's country exists on the policy, so that I do not re-enter values already configured on the policy.

8. As an operations user, I want blank optional columns to fall back to **policy-level defaults** when no country row exists, so that import still works for countries not explicitly listed on the policy.

9. As an operations user importing **DCL** limit type, I want **approved limit** to be optional and prefilled from country max limit or policy max DCL when blank, so that DCL bulk loads are efficient.

10. As an operations user re-importing the **same policy** for a customer, I want existing active CustomerPolicy fields **updated** (with blanks resolved from policy defaults), so that I can refresh limits and terms from a file.

11. As an operations user importing a **different policy** for a customer who already has one, I want the system to **switch policies with history** (deactivate old, create new active row), so that audit history is preserved.

12. As an operations user assigning a policy to a customer with **no active policy**, I want a new active CustomerPolicy row created, so that first-time assignment works from import.

13. As an operations user, I want optional columns for **customer number on policy**, **approved limit**, **expiration date**, **currency**, **payment term**, **MEP**, **reporting days**, **credit score**, **credit score input date**, **active customer since**, **excluded from policy**, and **exclusion reason**, so that I can override defaults when needed.

14. As an operations user setting **excluded from policy** to true, I want import to **require an exclusion reason**, so that validation matches manual customer edit.

15. As an operations user without access to a customer's business unit, I want the import row to **fail**, so that business-unit boundaries are enforced consistently with customer import.

16. As an admin, I want a dedicated **`import_policy`** permission, so that I can grant policy bulk import separately from customer master-data import.

17. As a user on an account **without** credit insurance, I should **not** see the Policy import tab, so that irrelevant import types are hidden.

18. As an operations user, I want import job tracking (progress, results, row-level errors) consistent with other import tabs, so that I can review failures after a large upload.

19. As an operations user, I want successful policy imports to trigger the same **credit-insurance sync** as manual edits (outdated DCL, gap pipeline, overdue flags), so that downstream metrics stay correct.

20. As an operations user uploading duplicate rows for the same customer in one file, I want rows processed **in file order with later rows winning**, so that intentional corrections in the same file work without failing the whole job.

21. As an operations user, I want clear row-level error messages when Named match fails, policy is invalid, customer is missing, or exclusion reason is missing, so that I can fix the spreadsheet and re-upload.

22. As a developer maintaining customer import, I want policy fields **removed** from customer import, so that there is a single supported bulk path for policy assignment.

23. As an English-speaking user, I want Policy import labels and validation messages in English, so that the tab matches the rest of import UX.

24. As a Hebrew-speaking user, I want Policy import labels and validation messages in Hebrew, so that the tab matches the rest of import UX.

25. As an operations user, I want to map spreadsheet column headers to system fields using the same field-mapper pattern as invoice/customer import, so that I do not need exact column names.

26. As an operations user importing **TopUp** or non-primary policies via policy number, I want the row to **fail**, so that only assignable primary policies can be linked through import.

27. As an operations user, I want **approved limit currency** and **credit score input date** to be optional explicit columns when I need to set them, so that I am not forced into automatic values I did not choose.

28. As a product owner, I want policy import to reuse existing **prefill** and **CustomerPolicy write** services, so that import behavior stays aligned with the UI over time.

29. As an operations user who previously relied on hidden customer-import policy columns, I want to use the Policy tab instead, so that behavior is documented and supported.

30. As an operations user, I want post-import **overdue metrics** refresh consistent with customer import job completion, so that account-level dashboards reflect new assignments.

## Implementation Decisions

### Domain target

- Each import row assigns or updates the customer's **active CustomerPolicy** row.
- **Customer** must already exist in the account (matched by `customer_number`).
- **InsurancePolicy** must resolve by `policy_number` to an **assignable primary** policy that is **effectively active** (same rules as manual assignment).
- **TopUp** and non-assignable policies are rejected.

### Field contract

**Required**

| Column | Semantics |
|--------|-----------|
| `policy_number` | Lookup active primary InsurancePolicy on account |
| `customer_number` | Lookup existing Customer on account |
| `limit_type` | `DCL` or `Named` (case-insensitive accepted at validation) |

**Conditionally required**

| Condition | Rule |
|-----------|------|
| `limit_type = Named` | A **NamedPolicy** row must match on the target policy (see lookup order below). Row **fails** if no match — even when `approved_limit` is provided in the file. |

**Optional** (blank → policy prefill chain)

| Column |
|--------|
| `customer_number_policy` |
| `approved_limit` |
| `approved_limit_expiration_date` |
| `approved_limit_currency` |
| `max_payment_term` |
| `max_allowed_mep` |
| `reporting_days` |
| `credit_score` |
| `credit_score_input_date` |
| `active_customer_since` |
| `excluded_from_policy` |
| `policy_exclusion_reason` |

**Not importable:** computed/cached gap and uninsured amounts, top-up totals, `zero_limit_date` (MVP).

### Prefill resolution (blank optionals)

Reuse existing **getCustomerPrefillForEdit** precedence:

1. **NamedPolicy** row (when applicable)
2. **InsurancePolicyCountry** for the customer's `country_id`
3. **InsurancePolicy** scalar defaults (`max_payment_term`, `max_allowed_mep`, `reporting_days`, `max_dcl` / country max limit)

For each optional column:

- If the file provides a non-blank value → use it.
- If blank → take the resolved prefill value for that field (may remain null if the chain has no value).

**Named lookup order:** `customer_number_policy` first, then `customer_number`. When `limit_type` is Named, use the Named-only match mode (fail closed with `no_named_match` when neither key hits a NamedPolicy row).

**DCL approved limit:** optional in the file; when blank, prefill from country max limit or policy max DCL per existing prefill logic.

**Explicit-only columns:** `approved_limit_currency` and `credit_score_input_date` are only set when provided in the file — prefill does not invent them.

### Upsert orchestration

Per row, after customer and policy resolve:

| Customer state | File `policy_number` vs active | Action |
|----------------|-------------------------------|--------|
| No active CustomerPolicy | — | Create active row with merged explicit + prefill values |
| Has active CustomerPolicy | Same policy | **Patch** active row via applyActivePolicyPatch |
| Has active CustomerPolicy | Different policy | **switchActivePolicy** (deactivate old, new active row with prefill) |

Duplicate `customer_number` rows in one file: process **in order**; last row wins.

### Validation rules

- Customer not found → row error
- Policy not found / not assignable primary / not effectively active → row error
- Named + no NamedPolicy match → row error
- `excluded_from_policy = true` and blank `policy_exclusion_reason` → row error
- User lacks business-unit access to customer → row error (same rules as customer import)
- Invalid `limit_type` value → row error

### Post-import side effects

After each successful row, run the same follow-up as manual CustomerPolicy save:

- applyActivePolicyPatch or switchActivePolicy (already includes outdated DCL recompute where applicable)
- syncCustomerInsuranceFields
- credit-insurance gap pipeline for the customer

On import **job complete**, trigger the same account-level post-import overdue metrics hook used by customer import.

### Permissions and visibility

- New permission: **`import_policy`**
- Policy tab shown when: user has `import_policy` **and** account `has_credit_insurance` is true
- API handler checks permission + account scope identically to other import endpoints

### Customer import cleanup

- Remove policy-related fields from **customer import** validation schema and import payload builder
- Customer import remains for master customer data only
- Policy tab is the **only supported** bulk policy assignment path

### Import infrastructure

- Add **`ImportType.Policy`** to the Prisma enum (SQL migration)
- New import API route following existing batch/job pattern (create job → batched POST → result page)
- New Policy processor UI component mirroring CustomerProcessor (file upload → field map → grid preview → submit)
- Wire import page tab with Policy icon/label and URL `?tab=policy` support

### Testing seam (single orchestration module)

Prefer **one** high-level service as the test seam — **`ImportPolicyService`** (or equivalent) — that accepts a normalized row + account context and returns success/error without requiring HTTP or React.

```typescript
type ImportPolicyRowInput = {
  policy_number: string
  customer_number: string
  limit_type: 'DCL' | 'Named'
  customer_number_policy?: string | null
  approved_limit?: string | number | null
  approved_limit_expiration_date?: string | null
  approved_limit_currency?: string | null
  max_payment_term?: number | null
  max_allowed_mep?: number | null
  reporting_days?: number | null
  credit_score?: string | number | null
  credit_score_input_date?: string | null
  active_customer_since?: string | null
  excluded_from_policy?: boolean | null
  policy_exclusion_reason?: string | null
}

type ImportPolicyRowResult =
  | { success: true; action: 'create' | 'patch' | 'switch' }
  | { success: false; errorCode: string; message: string }

// Orchestrates: resolve customer/policy → prefill merge → patch | switch | create
// Delegates writes to CustomerPolicyService + existing prefill helper
function importPolicyRow(
  row: ImportPolicyRowInput,
  context: { accountId: number; userId: string; userBusinessUnitId: number | null }
): Promise<ImportPolicyRowResult>
```

UI, API route, and job batching remain thin adapters over this service. **Do not** duplicate prefill logic — inject or call the existing InsurancePolicy prefill helper and CustomerPolicy write paths.

### Modules built or modified (summary)

| Area | Change |
|------|--------|
| Import page | New Policy tab + processor |
| Import API | New policy batch endpoint |
| Import job | Support `ImportType.Policy`; job complete hooks |
| Import policy service | New — row orchestration seam |
| CustomerPolicy service | Reused — patch / switch |
| Insurance policy service | Reused — prefill + assignable policy lookup |
| Permission service | Add `import_policy` |
| Customer import | Remove policy fields |
| Prisma | `ImportType.Policy` enum value |
| Locales | EN/HE import strings for Policy tab and validation |
| Unit tests | Import policy service |

### Grill-me decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | Import target | CustomerPolicy assignment for existing customers |
| D2 | Customer prerequisite | Fail if customer_number not found |
| D3/D15 | Upsert | Same policy → patch; different → switch; none → create |
| D4 | Empty optionals | Always resolve from policy prefill chain |
| D5 | Named, no NamedPolicy match | Fail row (no manual override) |
| D6 | Permission | New `import_policy` |
| D7 | Customer import overlap | Policy tab only — remove customer import policy fields |
| D8 | Tab visibility | `has_credit_insurance` + permission |
| D9 | Different policy_number | switchActivePolicy |
| D10 | NamedPolicy lookup | customer_number_policy first, then customer_number |
| D11 | DCL approved_limit | Optional; prefill when blank |
| D12 | Optional field set | Standard credit fields (+ D17/D18) |
| D13 | Assignable policies | Active primary only |
| D14 | Post-import effects | Full credit-insurance sync pipeline |
| D16 | Business unit access | Same as customer import |
| D17 | credit_score_input_date | Optional import column |
| D18 | approved_limit_currency | Optional import column |
| D19 | Import job enum | `ImportType.Policy` |
| D20 | Connector scope | File upload MVP only |
| D21 | Exclusion reason | Required when excluded_from_policy=true |
| D22 | Duplicate rows | Process in order; later row wins |

## Testing Decisions

**Principle:** Test **external behavior** through `importPolicyRow` — given row input + mocked persistence/policy context, assert create/patch/switch action, merged field values, and error codes. Do not assert internal call order of sync helpers beyond "sync invoked on success."

**Module under test:** Import policy orchestration service (single seam).

**Cases (minimum):**

| Scenario | Expected |
|----------|----------|
| Happy path — new assignment, DCL, country row exists | `create`; terms prefilled from country |
| Happy path — new assignment, DCL, no country row | `create`; terms prefilled from policy scalars |
| Same policy re-import with blank optionals | `patch`; fields replaced by fresh prefill |
| Different policy_number on customer with active policy | `switch`; old row deactivated |
| Named + matching NamedPolicy | success; Named prefill applied |
| Named + no NamedPolicy match | fail (`no_named_match` or equivalent) |
| Customer not found | fail |
| Invalid / TopUp / inactive policy_number | fail |
| excluded_from_policy=true, no reason | fail |
| User lacks BU access to customer | fail |
| Explicit override in file | patched value wins over prefill for that column |
| Duplicate customer rows in one batch | last row's outcome wins |

**Prior art:** `ImportContactService` unit tests (service seam + prisma mock), customer import API validation tests, `customerPolicyAdapter` / CustomerPolicy service tests for patch vs switch semantics.

**Integration (optional follow-up):** One API test posting a small batch and asserting import job record counts — lower priority than unit coverage on the orchestration service.

**Out of unit scope:** React field mapper UI, file parser, translation string content, connector/ERP sync.

## Out of Scope

- ERP / Priority connector entity for Policy (`importEntityFields` catalog)
- Importing **NamedPolicy** master rows or **InsurancePolicy** definitions
- Creating customers during policy import
- Importing computed gap/uninsured cache fields or `zero_limit_date`
- TopUp policy assignment via import
- Draft or non-active policy targets (except effectively active primary per existing lifecycle rules)
- Policy fields remaining on customer import (must be removed, not dual-maintained)
- New global theme/CSS beyond existing import tab patterns
- Report builder new fields for import job type (unless already generic)

## Further Notes

### Translations

New EN/HE keys under import namespace for tab label, field labels/descriptions, and validation error messages. Requires explicit approval per project rules before editing locale files.

### Risk

- **Customer import removal:** confirm no production scripts depend on hidden customer-import policy columns before merge.
- **Named strict fail:** operations must maintain NamedPolicy rows on policies before Named bulk import — document in import tab field descriptions.
- **ImportType migration:** coordinate deploy with code that references `ImportType.Policy` to avoid enum mismatch.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Import Policy — CustomerPolicy bulk assignment](https://app.clickup.com/t/869dw47dg)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Import policy — platform foundation (DCL create path) | [869dw47dq](https://app.clickup.com/t/869dw47dq) | — | 3–4, 7–9, 12, 15–16, 28 |
| 2 | Import policy — full orchestration (patch/switch/Named/sync) | [869dw47du](https://app.clickup.com/t/869dw47du) | 1 | 5–6, 10–11, 13–14, 19–21, 26–27, 30 |
| 3 | Import policy — UI tab & import job UX | [869dw47e4](https://app.clickup.com/t/869dw47e4) | 2 | 1–2, 17–18, 23–25, 29 |
| 4 | Customer import — remove policy fields | [869dw47e7](https://app.clickup.com/t/869dw47e7) | 3 | 22, 29 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development

**Tags:** `ready-for-agent`, `enhancement`, `import-policy`
