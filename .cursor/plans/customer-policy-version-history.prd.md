---
name: customer-policy-version-history
overview: Version customer policy attachments on Policies-tab saves (copy-on-write), surface prior snapshots in policy history, and show modified-at/by on the active policy plus history accordion headers.
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869dwmwdm
isProject: false
---

# Customer Policy Version History & Audit Display

## Problem Statement

On the customer **Policies** tab (credit insurance section), users can edit the attached policy’s customer-specific settings — approved limit, terms, exclusion, credit score, and related fields — while keeping the same insurance policy (e.g. TF1).

Today, **policy history** only records rows when the customer **switches** to a different insurance policy. Edits to the **same** attached policy update the active `CustomerPolicy` row **in place**, so prior values disappear and cannot be reviewed.

Additionally, `CustomerPolicy` rows already store **`modified_at`** and **`modified_by`**, but the customer Policies UI does not show who last changed the active attachment or when prior versions were superseded.

Users need a trustworthy audit trail for changes made on the Policies tab, without flooding history with system-driven recomputes.

## Solution

1. **Copy-on-write versioning** — When a user saves meaningful changes on the Policies tab and the insurance policy attachment stays the same, deactivate the current active `CustomerPolicy` row and create a new active row with the updated values. Prior snapshots appear in the existing **Policy history** accordion (same UX as policy switches).

2. **Skip no-op saves** — If none of the user-editable Policies-tab fields changed, do not create a new version (avoid duplicate history rows).

3. **Audit display** — Show **Modified at** and **Modified by** on the **active** policy readonly grid. On **history accordion headers**, append date and modifier when both are present; omit date/user entirely when either is missing.

4. **Clearer history labels** — Distinguish **Previous policy** (different insurance policy from active) from **Previous version** (same insurance policy, superseded snapshot).

5. **Gap freeze on deactivation** — Before deactivating a row for versioning, freeze capacity gap / uninsured amounts on that row (same behavior as policy switch), so historical snapshots remain stable.

## User Stories

1. As a credit insurance user, I want edits to the same attached policy on the Policies tab to appear in policy history, so that I can see what the limit and terms were before the latest save.

2. As a credit insurance user, I want policy switches to continue appearing in history as they do today, so that existing workflows are not regressed.

3. As a credit insurance user, I want to see **Modified at** and **Modified by** on the current policy attachment, so that I know when and who last changed the active settings.

4. As a credit insurance user, I want history accordion headers to show when a version was superseded and by whom (when available), so that I can quickly find the right snapshot without opening every panel.

5. As a credit insurance user, I want history headers to omit date/user when audit data is missing, so that the UI does not show misleading placeholders.

6. As a credit insurance user, I want a **Previous version** label when history rows refer to the same insurance policy as today’s active row, so that I can tell limit changes apart from policy switches.

7. As a credit insurance user, I want a **Previous policy** label when a history row refers to a different insurance policy than the active one, so that policy migration remains obvious.

8. As a credit insurance user, I want saving without changing any Policies-tab fields to not create a new history row, so that history stays readable.

9. As a credit insurance user, I want expanded history panels to continue showing the full field snapshot as today, so that detailed review behavior is unchanged.

10. As a credit insurance user editing approved limit from 8,000 to 10,000 on TF1, I want two TF1 entries in history (older inactive + current active), so that both values are preserved.

11. As a credit insurance user switching from TF0 to TF1, I want TF0 in history labeled as a previous policy, so that the event type is clear.

12. As a Hebrew-speaking user, I want new labels (Modified at, Modified by, Previous version) translated, so that the experience matches the rest of the app.

13. As an English-speaking user, I want the same audit labels in English, so that the experience matches the rest of the app.

14. As a user viewing modifier names, I want display names when resolvable from the user record, so that audit is human-readable.

15. As a developer, I want versioning logic centralized in the customer policy write path used by the Policies tab save, so that behavior is consistent and testable.

16. As a developer, I want pure helpers for diff detection and history header/chip resolution, so that UI and service tests can cover edge cases without brittle full-stack tests.

17. As a credit insurance user, I want cron/gap recomputes to not create history versions, so that automated jobs do not clutter policy history.

18. As a credit insurance user, I want inactive history rows to retain frozen gap/uninsured values at deactivation time, so that historical financial context does not drift after the fact.

19. As a credit insurance user with multiple inactive TF1 versions, I want history sorted with the most recently superseded first, so that recent changes are easy to find.

20. As a user with permission to edit customer policy fields, I want the Edit/Save flow on the Policies tab to trigger versioning automatically, so that I do not need a separate “save to history” action.

21. As a user without edit permission, I want readonly audit fields on the active policy when viewing, so that I can see last change metadata without editing.

22. As a product owner, I want policy import and bulk policy replace out of scope for this version, so that scope stays focused on the Policies tab UX.

23. As a developer, I want existing `CustomerPolicy` schema reused (no new history table), so that migration risk stays low.

24. As a developer, I want the customer GET payload to include modifier user display fields needed by the UI, so that the frontend does not N+1 user lookups.

25. As a credit insurance user, I want the active policy grid layout to remain a three-column readonly grid with two additional audit fields, so that the screen stays familiar.

26. As a credit insurance user, I want history accordion expand/collapse-all behavior unchanged, so that navigation habits are preserved.

27. As a developer, I want unit tests proving no-op saves do not increment inactive row count, so that regressions are caught in CI.

28. As a developer, I want unit tests proving allowlisted field changes trigger deactivate+create, so that copy-on-write is verified.

29. As a developer, I want unit tests for chip type resolution (previous policy vs previous version), so that labeling rules stay correct.

30. As a developer, I want unit tests for history header audit segments (show vs hide when partial data), so that grill decision B for missing audit is enforced.

## Implementation Decisions

### Domain model (unchanged schema)

- Continue using **`CustomerPolicy`** rows as version snapshots: `is_active = true` for current attachment; inactive rows for history.
- **No new tables** and no separate audit/changelog entity for this feature.
- **`modified_at`** / **`modified_by`** remain the canonical audit columns (grill decision: accept DB values as-is; system jobs may occasionally refresh them).

### Versioning trigger (Policies tab only)

- Apply copy-on-write only on the **customer Policies tab save path** (customer PUT credit insurance branch that calls active policy patch when `insurance_policy_id` is unchanged).
- **Do not** version on: cron gap sync, insurance field recompute, import policy patch, bulk policy replace, named-policy assignment batch jobs (unless explicitly added later).
- **Policy switch** (`insurance_policy_id` change) continues to use the existing switch flow (deactivate + create from prefill); do not double-version.

### Copy-on-write algorithm (same attachment)

When Policies-tab save resolves to an patch on the **same** `insurance_policy_id`:

1. Compute patched business fields (existing patch/merge logic).
2. Compare **before vs after** using an **explicit allowlist** of user-editable fields (see below).
3. If **no allowlisted change** → keep existing in-place update behavior (or skip write); **no new row**.
4. If **allowlisted change**:
   - Call **`freezeCustomerPolicyGapOnDeactivation`** on the current active row.
   - Set current active row `is_active = false`, set `modified_by` to saving user.
   - **Create** new active row with patched business fields, `created_by` / `modified_by` = saving user.
   - Run existing post-save insurance/gap pipeline on the customer (same as today after policy switch).

### Allowlisted fields for meaningful change

Snapshot only when at least one of these differs (normalized comparison for decimals, dates, null/empty):

- `insurance_policy_id`
- `customer_number_policy`
- `limit_type`
- `approved_limit`
- `approved_limit_currency`
- `approved_limit_expiration_date`
- `zero_limit_date`
- `max_payment_term`
- `max_allowed_mep`
- `reporting_days`
- `excluded_from_policy`
- `policy_exclusion_reason`
- `credit_score`
- `credit_score_input_date`
- `active_customer_since`

**Excluded from diff** (computed / system-maintained): capacity gap amounts and currencies, uninsured amounts and currencies, and other non–Policies-tab fields.

Derived fields such as **`outdated_dcl`** that change only as a side effect of allowlisted inputs do not alone trigger a snapshot; the allowlisted field change that caused them does.

### API / read model

- Extend customer policy history list select to include **`modified_by`** and resolve modifier **display name** (via existing User relation pattern used elsewhere for audit).
- Ensure **`modified_at`** is already exposed on history items in customer GET / adapter types (add if missing from frontend DTOs).
- History ordering: keep **`is_active desc`**, then **`modified_at desc`**, then **`id desc`**.

### UI — active policy grid

- Add readonly **Modified at** (formatted locale date/time) and **Modified by** (display name) to the active credit insurance grid on the Policies tab.
- Use existing readonly field / form field patterns; no new global styles.

### UI — policy history accordion

- **Header summary** (existing limit type / limit / expiration) plus optional audit segment: formatted **`modified_at`** and modifier display name, **only when both are present** (grill decision B).
- **Chip logic**:
  - Inactive row `insurance_policy_id` ≠ active row `insurance_policy_id` → **Previous policy**
  - Inactive row `insurance_policy_id` = active row `insurance_policy_id` → **Previous version**
- **Expanded panel**: unchanged field snapshot grid (no extra audit columns inside).

### Pure helpers (presentation seam)

Extract small pure functions for testability (shared or colocated with customer policy UI module):

```typescript
type CustomerPolicyHistoryChipKind = 'previous_policy' | 'previous_version'

function resolveCustomerPolicyHistoryChipKind(args: {
  inactiveInsurancePolicyId: number | null | undefined
  activeInsurancePolicyId: number | null | undefined
}): CustomerPolicyHistoryChipKind | null

function buildPolicyHistoryHeaderAuditSegment(args: {
  modifiedAt: Date | string | null | undefined
  modifiedByDisplayName: string | null | undefined
  formatDate: (value: Date | string) => string
}): string | null  // null → omit from header entirely
```

### Primary testing seam (service layer)

**Single write seam:** `CustomerPolicyService.applyActivePolicyPatch` (or extracted pure `planCustomerPolicyVersioning` called from it).

Behavior under test:

| Input | Expected |
|-------|----------|
| Same `insurance_policy_id`, allowlisted diff | deactivate old + create new active |
| Same `insurance_policy_id`, no allowlisted diff | no new inactive row |
| `insurance_policy_id` change | existing switch path (not this PRD’s patch versioning branch) |
| Versioning path | `freezeCustomerPolicyGapOnDeactivation` invoked before deactivate |

Extract **`hasMeaningfulCustomerPolicyFieldChange(before, after, allowlist)`** as a pure function co-located with service types for unit tests without DB.

### Modules touched (conceptual)

| Area | Change |
|------|--------|
| Customer policy write service | Copy-on-write branch, allowlist diff, gap freeze |
| Active policy resolver / history list | Include modifier user in select |
| Customer GET handler | Pass through audit + user display |
| Frontend policy adapter types | `modified_at`, `modified_by`, modifier name |
| Customer credit insurance Policies UI | Active audit fields, header audit segment, chip labels |
| Locales (EN/HE) | Modified at/by, Previous version |
| Unit tests | Diff helper, versioning branch, chip/header pure helpers |

### Translations

- New keys under customers/credit insurance copy: **Modified at**, **Modified by**, **Previous version** (EN + HE).
- Requires explicit approval per project rules before editing locale files.

## Testing Decisions

### What makes a good test

- Assert **observable behavior**: row counts, `is_active` flags, which service methods run, header/chip strings — not internal implementation order beyond the freeze→deactivate→create contract.
- Prefer **pure function tests** for allowlist diff, chip kind, and header audit segment (fast, deterministic).
- Service tests mock Prisma/transaction and assert deactivate+create vs in-place update paths.

### Modules to test

1. **`hasMeaningfulCustomerPolicyFieldChange`** — allowlist only; decimals/dates/null edge cases; computed field changes ignored.
2. **`CustomerPolicyService.applyActivePolicyPatch`** (or versioning planner) — copy-on-write vs no-op vs policy-id change delegation; freeze called before deactivate.
3. **`resolveCustomerPolicyHistoryChipKind`** — same vs different policy id; null ids.
4. **`buildPolicyHistoryHeaderAuditSegment`** — both present → segment; either missing → null.

### Prior art

- `tests/unit/creditInsurance/customerPolicy.test.ts` — policy types and adapter patterns.
- `tests/unit/creditInsurance/NamedPolicyAssignmentService.test.ts` — mocks `applyActivePolicyPatch`, gap freeze mocks.
- `tests/unit/shared/customerPolicyAdapter.test.ts` — effective policy resolution.
- UI patterns in `CustomerCreditInsuranceInfo` policy history accordion (manual QA; no new E2E required unless requested).

### Manual test plan (Policies tab)

1. Customer on TF1, limit 10,000 → Edit → change limit to 15,000 → Save → history shows prior TF1 row with 10,000; active shows 15,000 + modified audit.
2. Edit → Save with no changes → no new history row.
3. Switch TF1 → TF2 → TF1 inactive row chip = **Previous policy**; same-policy limit edit chip = **Previous version**.
4. Customer with old history rows lacking `modified_by` → header shows policy summary only (no date/user segment).

## Out of Scope

- Policy import-driven versioning.
- Bulk insurance policy replace in settings.
- Cron / gap job versioning.
- Field-level diff view (“limit changed from X to Y”) inside accordion panels.
- Dedicated `last_user_modified_at` columns (grill rejected in favor of raw `modified_at` / `modified_by`).
- Backfill migration for missing historical `modified_by`.
- Changes to `CustomerPolicyTrend` daily snapshots.
- Insurance **master policy** (`InsurancePolicy`) edit history on the customer screen.
- New report builder fields for policy version history.

## Further Notes

### Established grill decisions (reference)

| Topic | Decision |
|-------|----------|
| Versioning model | Copy-on-write snapshots (A) |
| Save scope | Policies tab user saves only |
| No-op saves | Skip snapshot (A) |
| Audit UI placement | Active grid + history headers only (C) |
| History header date | `modified_at` = superseded time (A) |
| Chip labels | Previous policy vs previous version (A) |
| Audit columns | Use DB `modified_at` / `modified_by` as-is (C) |
| Diff rule | Explicit allowlist (A) |
| Gap on deactivate | Freeze like policy switch (A) |
| Missing audit | Hide date/user in header (B) |

### Testing seam confirmation

The intended **single write seam** is the customer policy patch/versioning path in **`CustomerPolicyService`**, with pure helpers for diff and UI header/chip resolution. Confirm this matches expectations before `/to-issues`; adjust only if product wants versioning at the HTTP handler layer instead.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Customer Policy Version History & Audit Display](https://app.clickup.com/t/869dwmwdm)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Policies-tab copy-on-write versioning | [869dwmwdx](https://app.clickup.com/t/869dwmwdx) | — | 1, 2, 8, 10, 15–20, 27–28 |
| 2 | Policy audit display & history labels | [869dwmwdy](https://app.clickup.com/t/869dwmwdy) | 1 | 3–7, 9, 11–14, 21, 25–26, 29–30 |

**Related (non-blocking):** [Named Policy Assignment UX](https://app.clickup.com/t/869dw4gyr)

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development

**Tags:** `ready-for-agent`, `enhancement`

### Follow-up (optional)

- If `modified_at` drift from cron becomes user-visible noise, revisit dedicated user-audit columns in a later PRD.
