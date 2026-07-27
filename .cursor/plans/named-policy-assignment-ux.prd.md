---
name: named-policy-assignment-ux
overview: Policy-page Named Policy flow creates and syncs CustomerPolicy assignments, blocks duplicate master rows in the add picker, lists Named customers on the grid, backfills orphan masters on load, and deactivates assignments on master delete.
source: grill-me session + DCL→Named patch drill-down
clickup_task_url: https://app.clickup.com/t/869dw4gyr
isProject: false
---

# Named Policy Assignment UX

## Problem Statement

On the credit insurance policy detail page, the **Named Policies** section behaves as master-config only. Adding a Named Policy row does not assign the customer to the policy. The add modal lets users pick any customer, including one who already has a NamedPolicy row on that policy (duplicate is caught only on save). The grid lists NamedPolicy master rows, not customers actually connected to the policy via active CustomerPolicy assignments. Operations must assign or convert customers elsewhere (customer edit, import), which is disjoint from where Named limits are configured.

## Solution

Unify Named Policy management on the policy page with CustomerPolicy assignment:

- **Add modal** — exclude customers who already have a NamedPolicy row on this policy (silent exclusion in autocomplete); customer must exist (picker only).
- **Add save** — in one transaction, create the NamedPolicy master row and assign or update the customer's active CustomerPolicy (create, switch, patch, or DCL→Named conversion per prior state).
- **Edit save** — update NamedPolicy master and sync matching fields to the customer's active Named CustomerPolicy on this policy; customer number read-only in edit mode.
- **Delete** — remove NamedPolicy master and deactivate the customer's active CustomerPolicy on this policy (`is_active = false`, history preserved); run credit-insurance sync pipeline.
- **Grid** — list customers with an active CustomerPolicy on this policy where `limit_type = Named`; display NamedPolicy master column values; on page load, auto-create missing NamedPolicy master rows from assignment data so every row is editable.
- **DCL→Named on same policy** — allowed when adding a NamedPolicy for a customer already on this policy as DCL; conversion uses an explicit patch (see Implementation Decisions).

## User Stories

1. As a credit insurance admin, I want the Add Named Policy picker to exclude customers who already have a NamedPolicy row on this policy, so that I edit the existing row instead of creating duplicates.

2. As a credit insurance admin, I want excluded customers to simply not appear in the picker, so that the add flow stays uncluttered.

3. As a credit insurance admin, I want to pick only existing account customers when adding a Named Policy, so that assignments always resolve to a real Customer record.

4. As a credit insurance admin, I want saving a new Named Policy to create an active CustomerPolicy for a customer with no prior assignment, so that the customer is connected to the policy immediately.

5. As a credit insurance admin, I want saving a new Named Policy to switch a customer from a different active policy to this policy with Named limit type, so that policy changes stay in one flow.

6. As a credit insurance admin, I want saving a new Named Policy to update an existing Named assignment on this policy, so that I can refresh limits and terms from the modal.

7. As a credit insurance admin, I want to add a Named Policy for a customer currently on this policy as DCL and have them converted to Named, so that I do not have to edit the customer record separately.

8. As a credit insurance admin, when converting DCL→Named on add, I want the customer's credit score set to the policy minimum (same as customer UI prefill), so that Named assignment rules stay consistent.

9. As a credit insurance admin, when converting DCL→Named on add, I want any DCL `zero_limit_date` cleared when a named approved limit is applied, so that stale DCL zero-limit state does not carry over.

10. As a credit insurance admin, I want NamedPolicy and CustomerPolicy writes on add/edit/delete to succeed or fail together, so that I never have a master row without a matching assignment or vice versa.

11. As a credit insurance admin, I want editing a Named Policy to sync limit and term fields to the customer's active Named CustomerPolicy on this policy, so that assignment data matches master configuration.

12. As a credit insurance admin, I want the customer number field read-only when editing a Named Policy, so that row identity stays stable.

13. As a credit insurance admin, I want deleting a Named Policy to deactivate the customer's active assignment on this policy while keeping history, so that audit trails are preserved.

14. As a credit insurance admin, I want delete to trigger the same credit-insurance sync pipeline as other policy changes, so that dashboards and gap metrics stay correct.

15. As a credit insurance admin, I want the Named Policies grid to show all customers with an active Named CustomerPolicy on this policy, so that I see who is actually connected.

16. As a credit insurance admin, I want the grid to display NamedPolicy master field values (customer max limit, MEP, terms, expiration), so that the section reflects configured Named terms.

17. As a credit insurance admin, I want orphan Named assignments (CustomerPolicy without a master row) to get a NamedPolicy master row automatically when I open the policy page, so that every grid row is editable in the Named modal.

18. As a credit insurance admin, I want load-time backfill to be idempotent, so that revisiting the page does not create duplicate master rows.

19. As a credit insurance admin, I want DCL-only customers on this policy to remain out of the Named Policies grid, so that the section scope stays Named-specific.

20. As a credit insurance admin, I want export of Named Policies to reflect master field values for listed customers, so that exports match the grid.

21. As a developer, I want a single orchestration service for add/edit/delete/backfill, so that behavior stays aligned with import and customer save over time.

22. As a developer, I want unit tests on that orchestration seam, so that assignment branches are verified without UI or HTTP.

23. As an English-speaking user, I want validation messages for Named Policy flows in English, so that UX matches the rest of settings.

24. As a Hebrew-speaking user, I want validation messages for Named Policy flows in Hebrew, so that UX matches the rest of settings.

25. As a credit insurance admin without write permission, I want add/edit/delete blocked as today, so that access control is unchanged.

26. As a product owner, I want Named bulk import (Policy import tab) to remain dependent on NamedPolicy master rows, so that policy-page add continues to be the supported path to create both master and assignment together.

## Implementation Decisions

### Grill-me decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | Add modal — who is blocked | Customers with an existing **NamedPolicy** row on **this** policy |
| D2 | Grid data source | Active **CustomerPolicy** on this policy where `limit_type = Named` |
| D3 | Add — CustomerPolicy side effect | No active → create; different policy → switch; same policy → patch |
| D4 | Edit — sync to CustomerPolicy | Yes when active Named CustomerPolicy on this policy |
| D5 | Delete NamedPolicy | Also deactivate assignment on this policy |
| D6 | Grid without master row | Auto-create NamedPolicy from CustomerPolicy fields |
| D7 | Customer on this policy as DCL | Allow add — converts to Named via same-policy patch |
| D8 | Delete deactivation | `is_active = false` + credit-insurance sync pipeline |
| D9 | Picker UX for existing NamedPolicy | Exclude silently from autocomplete |
| D10 | Edit customer number | Read-only in edit mode |
| D11 | Auto-create master timing | On policy page load (before grid render) |
| D12 | Grid columns | NamedPolicy master fields |
| D13 | Save atomicity | Single DB transaction |
| D14 | Customer must exist | Autocomplete only |
| D15 | DCL→Named `credit_score` | Set to policy `min_credit_score` (customer UI prefill parity) |
| D16 | DCL→Named `zero_limit_date` | Clear (`null`) when applying named approved limit |

### Domain model (unchanged schema)

- **NamedPolicy** — per-policy master config keyed by `customer_number` string (not a Customer FK).
- **CustomerPolicy** — per-customer assignment history; one active row per customer; `limit_type` Named or DCL.
- No Prisma schema changes required for MVP.

### Single orchestration seam

Introduce **NamedPolicyAssignmentService** (name flexible) as the **one test seam** for all write and backfill behavior. UI and API handlers remain thin adapters.

Responsibilities:

| Operation | Behavior |
|-----------|----------|
| `ensureNamedPolicyMastersForPolicy` | On policy page load: for each active Named CustomerPolicy on this policy without a matching NamedPolicy row (match by `customer_number` = main customer number or existing `customer_number_policy`), insert master row from assignment fields; idempotent |
| `createNamedPolicyWithAssignment` | Transaction: insert NamedPolicy from modal → branch on active CustomerPolicy → patch / switch / create → sync pipeline |
| `updateNamedPolicyWithSync` | Transaction: update NamedPolicy → sync patch to active Named CustomerPolicy on this policy if present |
| `deleteNamedPolicyWithDeactivation` | Transaction: delete NamedPolicy → deactivate active CustomerPolicy on this policy → sync pipeline |

Delegate persistence to existing **InsurancePolicyService** (NamedPolicy CRUD) and **CustomerPolicyService** (`applyActivePolicyPatch`, `switchActivePolicy`), plus **syncCustomerInsuranceFields** and **syncCreditInsuranceGapPipelineForCustomer** after successful transaction (same pattern as customer save).

### Shared field mapper

**`namedMasterToCustomerPolicyPatch`** maps NamedPolicy master fields to CustomerPolicy write input:

| NamedPolicy | CustomerPolicy |
|-------------|----------------|
| `customer_number` | `customer_number_policy` |
| `customer_max_limit` | `approved_limit` |
| `limit_expiration_date` | `approved_limit_expiration_date` |
| `max_payment_term` | `max_payment_term` |
| `customer_mep` | `max_allowed_mep` |
| `reporting_days` | `reporting_days` |
| — | `limit_type: "Named"` (when converting or creating Named assignment) |

Used for: add assignment branches, edit sync, and load-time backfill (inverse mapping for master create from assignment).

### Add save — CustomerPolicy branches

After NamedPolicy insert in transaction, resolve customer by `customer_number` + account; fail if not found.

| Prior active CustomerPolicy | Action |
|---------------------------|--------|
| None | `applyActivePolicyPatch` with `policy_id` set to this policy + named master patch |
| Same `insurance_policy_id`, `limit_type = Named` | `applyActivePolicyPatch` with named master patch only (no `policy_id`) |
| Same `insurance_policy_id`, `limit_type = DCL` | `applyActivePolicyPatch` with DCL→Named conversion patch (below) |
| Different `insurance_policy_id` | `switchActivePolicy` with `limitType: Named`, then `applyActivePolicyPatch` with form overrides if switch prefill differs from modal |

### DCL→Named conversion patch (same policy, on add)

When prior active row is on **this** policy with `limit_type = DCL`, call **`applyActivePolicyPatch`** (not `switchActivePolicy`).

**Patch payload** (from modal / newly inserted NamedPolicy master):

```typescript
{
  limit_type: "Named",
  customer_number_policy: master.customer_number.trim(),
  approved_limit: master.customer_max_limit,
  approved_limit_expiration_date: master.limit_expiration_date ?? null,
  max_payment_term: master.max_payment_term,
  max_allowed_mep: master.customer_mep,
  reporting_days: master.reporting_days,
  credit_score: policy.min_credit_score,      // D15 — UI parity
  zero_limit_date: null,                        // D16 — clear DCL zero-limit state
}
```

**Omit** (preserve from existing DCL row): `insurance_policy_id`, `approved_limit_currency`, `excluded_from_policy`, `policy_exclusion_reason`, `active_customer_since`.

**Automatic effects** inside `applyActivePolicyPatch`: `outdated_dcl` recomputed to `false` when `limit_type` changes to Named; no DCL approved-limit auto-adjust for Named.

### Edit save

- NamedPolicy PUT with immutable `customer_number` in UI (server should reject customer_number change on update for safety, or ignore).
- If customer has active Named CustomerPolicy on this policy: `applyActivePolicyPatch` with named master patch **without** DCL conversion extras (`credit_score` / `zero_limit_date` unchanged unless business rules extend later).

### Delete save

- Delete NamedPolicy row.
- If customer has active CustomerPolicy on this policy: set `is_active = false` on that row (do not delete history row).
- Run credit-insurance sync pipeline for customer.

### Policy detail read API

Extend policy fetch (or dedicated sub-resource) to return **Named customer assignments** for the grid:

- Query active CustomerPolicy where `insurance_policy_id = policyId` and `limit_type = Named`, include Customer for display/search.
- Join NamedPolicy master by `customer_number` (and fallback `customer_number_policy` if needed for legacy rows).
- Run `ensureNamedPolicyMastersForPolicy` before returning list (or as explicit step in GET handler).

Grid row identity: prefer `CustomerPolicy.id` or `customer_id`; master `NamedPolicy.id` for edit modal.

### UI changes

- **CustomerNumberAutocomplete** — optional `excludeCustomerNumbers: string[]` prop; policy page passes existing NamedPolicy `customer_number` values on this policy when modal is in add mode.
- **Add Named modal** — customer picker only; no free text.
- **Edit Named modal** — disable customer number field.
- **Grid** — data from new API shape; columns unchanged (master field names); click row opens edit modal with master row.

### Permissions and visibility

- Unchanged: credit insurance account + insurance write permission for mutations; read for grid.

### Modules built or modified (summary)

| Area | Change |
|------|--------|
| Named policy assignment service | New — orchestration seam |
| Insurance policy service | Reuse NamedPolicy CRUD; optional backfill helper |
| Customer policy service | Reuse patch / switch |
| Insurance policy API handlers | Wire orchestration on NamedPolicy POST/PUT/DELETE; extend policy GET |
| Policy detail page | Grid source, modal exclusions, edit read-only customer number |
| Customer number autocomplete | Exclude list prop |
| Credit insurance sync | Reuse post-mutation pipeline |
| Locales | New strings only if needed (EN/HE, approval required) |
| Unit tests | Orchestration service |

### Codebase scan

**Required**

| Area | Reason |
|------|--------|
| Named policy assignment orchestration (new) | Single write/backfill seam |
| Insurance policy NamedPolicy API handlers | Replace direct `createNamedPolicyRow`-only POST |
| Policy detail page Named section | Grid, modals, picker exclusion |
| Customer number autocomplete | `excludeCustomerNumbers` |
| Policy detail GET / include shape | Named CustomerPolicy + master join for grid |
| Customer policy service | Patch / switch / deactivate |
| Credit insurance sync helpers | Post save/delete |

**Optional / follow-up**

| Area | Reason |
|------|--------|
| Insurance policy trend / NamedPolicy trend | May reflect new masters from backfill — verify snapshot jobs |
| Export handler on policy page | Align export rows with new grid source |

**No change needed**

| Area | Reason |
|------|--------|
| Prisma schema | No new tables or columns |
| Import policy service | Already assigns via CustomerPolicy; benefits from masters created on policy page |
| Customer detail save path | Unchanged; policy page becomes parallel entry point |
| TopUp policy detail | Named section is primary-policy concern unless product extends |

## Testing Decisions

**Principle:** Test **external behavior** through **NamedPolicyAssignmentService** (or equivalent single seam) — given account context, customer state, and modal/master input, assert resulting NamedPolicy + CustomerPolicy state and action branch. Mock Prisma / delegate services; do not assert internal sync call order beyond "sync invoked on success."

**Module under test:** Named policy assignment orchestration service.

**Cases (minimum):**

| Scenario | Expected |
|----------|----------|
| Add — no active CustomerPolicy | NamedPolicy created; active CustomerPolicy created Named with mapped fields |
| Add — active on different policy | switch + patch; Named master exists |
| Add — active Named on same policy | patch only; no duplicate master |
| Add — active DCL on same policy | patch with `limit_type Named`, `credit_score` = policy min, `zero_limit_date` null |
| Add — duplicate NamedPolicy customer on policy | rejected before write (or 409) |
| Edit — sync | NamedPolicy updated; active Named CustomerPolicy fields match master |
| Edit — customer number immutable | UI disabled; server ignores or rejects change |
| Delete | NamedPolicy removed; active CustomerPolicy `is_active = false` |
| Backfill on load | Named CustomerPolicy without master → master created once; idempotent on second call |
| Transaction rollback | NamedPolicy insert fails → no CustomerPolicy change |
| Picker exclusion set | exclude list contains existing master customer numbers |

**Prior art:** `ImportPolicyService` unit tests (orchestration + mocked CustomerPolicyService), `CustomerPolicyService` / `applyActivePolicyPatch` tests for limit_type and outdated_dcl behavior, existing NamedPolicy API 409 handling.

**Out of unit scope:** React grid/modal, autocomplete rendering, translation strings, load-time performance at very large policy sizes.

## Out of Scope

- DCL customers in the Named Policies grid
- Free-text customer numbers on add (non-autocomplete)
- Changing customer number on edit
- TopUp policy Named section (unless explicitly requested)
- New global theme/CSS beyond existing modal/grid patterns
- ERP/import changes beyond existing Import Policy PRD
- Hard-delete CustomerPolicy history on NamedPolicy delete
- Prompting user to confirm sync on edit

## Further Notes

### Translations

New EN/HE keys only if new user-facing errors are introduced (e.g. customer not found on save). Requires explicit approval per project rules before editing locale files.

### Risks

- **Load-time backfill** on policies with many Named customers — keep backfill scoped to rows missing master only; monitor query cost.
- **Grid vs master columns** — grid driven by CustomerPolicy but displays master fields; after edit sync they should match; QA should verify.
- **Alignment with import-policy PRD** — Named import still requires NamedPolicy master; policy-page add is the primary UX to create master + assignment together.

### Relationship to import-policy

The Import Policy PRD (`import-policy.prd.md`) bulk-assigns CustomerPolicy for existing customers and requires a NamedPolicy row for Named limit type. This PRD ensures policy-page Named configuration creates both master and assignment, reducing orphan masters and manual customer edits.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Named Policy Assignment UX](https://app.clickup.com/t/869dw4gyr)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Named policy assignment — platform foundation (add create path) | [869dw4h17](https://app.clickup.com/t/869dw4h17) | — | 3–4, 10, 21–22 |
| 2 | Named policy assignment — full write orchestration (switch/patch/DCL/edit/delete) | [869dw4h1h](https://app.clickup.com/t/869dw4h1h) | 1 | 5–14, 22 |
| 3 | Named policy assignment — policy page UI (grid, backfill, modals) | [869dw4h1q](https://app.clickup.com/t/869dw4h1q) | 2 | 1–2, 11–12, 15–20, 23–25 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development

**Tags:** `ready-for-agent`, `enhancement`, `named-policy-assignment`
