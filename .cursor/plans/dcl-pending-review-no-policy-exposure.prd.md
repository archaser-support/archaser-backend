---
name: dcl-pending-review-no-policy-exposure
overview: Auto-assign new customers to DCL with pending-review exclusion; unify uncovered-exposure KPI rules (no linked policy or any exclusion) for capacity gap, term breach, and notifications; expand No Policy Exposure card/report and dashboard filter; reason-only exclusion UX; audit-only invoice CTV flag.
source: grill-me sessions + to-prd synthesis (uncovered exposure gap/breach parity, CTV semantics)
clickup_task_url: https://app.clickup.com/t/869dycrat
isProject: false
---

# DCL Pending Review & No Policy Exposure

## Problem Statement

Credit analysts need a consistent way to handle **new customers** who are not yet under a **Named** insurance policy. Today those customers often have **no linked policy** at all, so they appear on the credit dashboard’s **No Policy Exposure** card but are invisible to policy workflows until someone manually assigns coverage.

Separately, customers **excluded from policy** and customers **without a linked policy** should not go through normal **capacity gap** or **terms breach** calculations. Exclusion is an intentional exception—not a payment-term violation—and uninsured customers should not show policy-style gap math. Today capacity gap writers still compute and persist values for excluded customers (unlike outdated DCL, which short-circuits writers), portfolio and customer KPIs disagree on terms breach for these cohorts, and the invoice `ctv_customer_excluded_from_policy` flag is used inconsistently across golden harness vs portfolio SQL.

Analysts want excluded customers (especially **Pending review**) grouped with **uninsured exposure** on the **No Policy Exposure** card, with a drill-down **report**, and a dashboard filter to show or hide that card cohort across portfolio KPIs. Other exclusion reasons remain on the **policy-risk** path but share the same simplified gap/breach rules.

Today exclusion is controlled by a separate **Excluded from policy** toggle plus a free-text **Policy exclusion reason** field. That two-control model is redundant and allows inconsistent rows. Analysts should set exclusion **only** via a standardized reason dropdown; clearing the reason means the customer is **not excluded**.

## Solution

1. **Auto DCL + pending review (forward-only)** — When a **new customer** is created on a **credit-insurance account**, automatically create an active **DCL** `CustomerPolicy` on the account’s **only active Primary** policy, with normal DCL prefill and `policy_exclusion_reason = "Pending review"` (derived `excluded_from_policy = true`). Skip silently when the account has zero or multiple active Primary policies, when the customer already has an active **Named** assignment, or when any active linked policy already exists that blocks assignment per skip rules.

2. **Uncovered exposure KPI rules (unified)** — Customers with **no active linked policy** or **any non-empty exclusion reason** share one KPI model: **capacity gap = 0** (writers skip and persist zeros), **customer-level terms breach = full open AR**, **at-risk = full open AR**, **notifications suppressed**. Portfolio **Terms Breach** card/chart **omits** this entire cohort (no-policy and all excluded). **No Policy Exposure card** remains a **narrower** subset: true no-policy **or Pending review only**.

3. **No Policy Exposure card** — Count customers in the **card cohort** (no linked policy or pending-review exclusion; open AR > 0). Other exclusion reasons (**Credit hold**, **Insurer declined**, **Other**) stay on policy-risk only—not on this card. Card members use **full open AR** for at-risk. Enable **policy-scoped** values when a single policy is selected. Wire **card click** to drill-down report.

4. **Terms Breach chart** — Remove the **Excluded from policy** category permanently. **Uncovered exposure** customers (no linked policy + all excluded) do not contribute to portfolio terms-breach totals or breach-by-reason charts. On **customer detail**, Terms Breach KPI shows **full open AR** for uncovered customers.

5. **Capacity gap writers** — Short-circuit gap sync for uncovered customers: zero `CustomerPolicy` and invoice gap fields (same pattern as outdated DCL). Read-time suppress alone is insufficient.

6. **Dashboard filter** — **With excluded customers / Without excluded customers** (default: **With**). When **Without**, hide the **No Policy Exposure card cohort** (no-policy + pending-review) from **all** portfolio summary KPIs. Uncovered-exposure KPI rules still apply regardless of filter; filter only controls visibility of the card cohort on the dashboard.

7. **Exclusion reason UX (reason-only)** — Remove **Excluded from policy** toggle everywhere. **Clearable Autocomplete** with allowlist: **Pending review**, **Credit hold**, **Insurer declined**, **Other**. Server derives `excluded_from_policy` on write. On exclusion set: **zero gap fields immediately**; do **not** run full CTV/breach refresh on save.

8. **Invoice `ctv_customer_excluded_from_policy`** — **Audit/report only**; means “non-empty exclusion reason at snapshot time.” **False** for no-policy customers. Updated on invoice events and policy refresh cron—not on exclusion-reason save alone. **Not** an input to KPI math.

9. **No Policy Exposure report** — Customer-level rows for the **card cohort**, respecting policy scope, business-unit scope, and dashboard filter.

10. **Deploy datafix** — One-time reconciliation of legacy exclusion toggle/reason mismatches before rollout.

11. **Lazy recalc on state transitions** — When exclusion is cleared or customer gets first linked policy, accept stale gap/breach KPIs until the next cron (no eager full pipeline on save).

## User Stories

1. As a credit analyst, I want new customers without a Named policy to be automatically placed on DCL under **Pending review** exclusion, so that every new debtor is tracked under a policy row while awaiting vetting.

2. As a credit analyst, I want auto-assignment to use the account’s normal DCL limits and country/policy defaults, so that pending-review customers have realistic limit fields without manual data entry.

3. As a credit analyst, I want auto-assignment to skip customers who already have an active **Named** policy assignment, so that vetted Named customers are never overwritten.

4. As a credit analyst, I want auto-assignment to skip silently when the account has no single active Primary policy, so that customer create/import is never blocked by insurance configuration gaps.

5. As an operations user importing customers, I want the same auto DCL + pending-review behavior as billing-connector creates, so that ingress paths behave consistently.

6. As a credit analyst, I want customers with **Pending review** exclusion to appear on the **No Policy Exposure** dashboard card alongside customers with no linked policy, so that uninsured and awaiting-review exposure is visible in one place.

7. As a credit analyst, I want customers excluded for other reasons (**Credit hold**, **Insurer declined**, **Other**) to **not** appear on the No Policy Exposure card, so that the card stays focused on uninsured and pending-review cohorts.

8. As a credit analyst, I want pending-review and true no-policy customers to contribute **full open AR** to at-risk exposure, so that dashboard risk totals reflect uninsured exposure correctly.

9. As a credit analyst, I want uncovered-exposure customers removed from the **portfolio Terms Breach** chart and totals, so that intentional exclusions and no-policy customers are not misread as payment-term violations.

10. As a credit analyst, I want to click the No Policy Exposure card and open a customer list report, so that I can act on the cohort without building ad-hoc filters.

11. As a credit analyst, I want the No Policy Exposure report to show customer name, number, open AR, exclusion reason, and policy number, so that I have enough context to prioritize follow-up.

12. As a credit analyst, I want the No Policy Exposure card and report to respect the dashboard **policy filter**, so that I can review exposure within a selected policy.

13. As a credit analyst, I want a dashboard toggle **With excluded customers / Without excluded customers** (default **With**), so that I can switch between seeing and hiding the no-policy exposure card cohort.

14. As a credit analyst, when **Without excluded customers** is selected, I want true no-policy and pending-review customers hidden from **all** dashboard KPIs—not only the card—so that portfolio metrics can exclude that cohort entirely.

15. As a credit analyst editing a customer, I want to set exclusion **only** via a clearable reason dropdown (no separate toggle), so that one control defines exclusion state unambiguously.

16. As a credit analyst, I want to clear exclusion by clearing the dropdown, so that I can return a customer to normal policy coverage without a separate switch.

17. As a credit analyst, I want only allowlisted exclusion reasons savable, so that reporting and dashboard cohorts stay consistent.

18. As an operations user importing policy rows, I want to set exclusion via the **policy exclusion reason** column only (no boolean column), so that import matches the UI model.

19. As a Hebrew-speaking user, I want new filter labels, dropdown options, report title, and updated tooltips translated, so that the credit dashboard remains fully localized.

20. As an English-speaking user, I want the same new strings in English, so that copy is consistent across locales.

21. As a developer, I want auto-assignment centralized in one service invoked from customer-create hooks, so that future create paths can opt in without duplicating insurance logic.

22. As a developer, I want shared helpers for **is excluded?** and **is uncovered exposure?**, so that dashboard, gap writers, term-breach resolver, and notifications do not drift.

23. As a developer, I want **card cohort** and **uncovered KPI cohort** centralized in the credit dashboard summary layer, so that cards, reports, snapshots, and filters share one definition per cohort.

24. As a QA engineer, I want unit tests proving cohort classification, uncovered gap/breach math, filter on/off behavior, auto-assign skip paths, reason-only write derivation, and portfolio terms-breach exclusion, so that regressions are caught without brittle UI tests.

25. As a product owner, I want existing customers without policy **not** backfilled automatically for DCL assignment, so that forward-only rollout avoids mass policy mutations.

26. As a credit analyst with a customer on **Pending review**, I want clearing the exclusion reason (and Named assignment when appropriate) to move them off the No Policy Exposure card, so that the card reflects current vetting state.

27. As a credit analyst viewing **Terms Breach** drill-down, I want **Excluded from policy** no longer available as a breach-reason filter, so that report filters match the chart.

28. As a user on the customer credit-insurance tab, I want the exclusion reason control to match the General Information tab, so that the same validation and options apply everywhere.

29. As a report builder user, I want **policy exclusion reason** available as a field and the redundant **excluded from policy** boolean removed, so that exports match the new model.

30. As an ops engineer, I want a deploy-time datafix reconciling legacy toggle/reason mismatches, so that production data matches reason-only semantics before go-live.

31. As a credit analyst, I want customers **without a linked policy** to follow the same capacity gap and terms breach rules as excluded customers, so that uninsured exposure is treated consistently.

32. As a credit analyst viewing a **no-policy** customer, I want the customer detail **Terms Breach** KPI to show **full open AR**, so that I see total uninsured exposure even though portfolio Terms Breach omits them.

33. As a credit analyst, I want **capacity gap = 0** for all uncovered-exposure customers (no-policy and excluded), so that gap cards and policy-style limit math do not misrepresent uninsured debtors.

34. As a credit analyst with a **Credit hold** excluded customer, I want them off the No Policy Exposure card but still with **zero capacity gap** and **no portfolio terms breach**, so that policy-risk and card cohorts stay distinct.

35. As a developer, I want gap writers to **skip and zero** for uncovered customers even when invoices carry a `policy_id` tag, so that stored gap fields cannot drift.

36. As a developer, I want **no credit-insurance notifications** (capacity gap and terms breach) while a customer is uncovered, so that alerts match KPI semantics.

37. As an auditor, I want `ctv_customer_excluded_from_policy` on invoices to record **exclusion reason at snapshot time**, so that I can trace historical exclusion state without it driving KPI totals.

38. As a developer, I want `ctv_customer_excluded_from_policy` **excluded from KPI math** (golden harness, portfolio aggregation), so that one resolver owns breach semantics.

39. As a credit analyst clearing exclusion or receiving first policy assignment, I accept **stale gap/breach KPIs until cron**, so that saves stay fast and consistent with lazy recalc policy.

40. As a report user, I want `ctv_customer_excluded_from_policy` still available in reports and invoice grids as an audit column, so that compliance review remains possible.

## Implementation Decisions

### Domain vocabulary

- **Linked policy** — Active `CustomerPolicy` row with non-null `insurance_policy_id` (same as `customerHasLinkedInsurancePolicy`).
- **Without policy / no linked policy** — Customer has **no active linked policy** (`insurance_policy_id` null on active row, or no active row).
- **Named assignment** — Active `CustomerPolicy` with `limit_type = Named`.
- **Policy exclusion (excluded customer)** — `policy_exclusion_reason` is non-empty (trimmed). Equivalently `isCustomerPolicyExcluded(reason) === true`. The `excluded_from_policy` boolean is **derived on write** from reason.
- **Pending review exclusion** — `policy_exclusion_reason` matches **Pending review** (case-insensitive; store canonical **Pending review** on auto-assign).
- **Not excluded** — `policy_exclusion_reason` is null or empty; derived `excluded_from_policy = false`.
- **Uncovered exposure (KPI cohort)** — Customer satisfies **either**: (a) no active linked policy, **or** (b) any non-empty exclusion reason. Drives capacity gap, term breach, at-risk, notifications.
- **No Policy Exposure card cohort** — **Narrower** than uncovered KPI cohort: open AR > 0 and (**no linked policy** **or** **pending-review exclusion**). Credit hold / Insurer declined / Other are **out** of card but **in** uncovered KPI cohort.
- **Primary policy** — `InsurancePolicy` with `policy_kind = Primary` and active status per existing assignable-policy rules.

### Shared classification helpers

Extend `policyExclusion` (or adjacent module) with:

```
isCustomerPolicyExcluded(reason) → boolean
isPendingReviewExclusion(reason) → boolean
hasActiveLinkedPolicy(customerId | policyFields) → boolean
isUncoveredExposureCustomer({ hasLinkedPolicy, exclusionReason }) → boolean
isNoPolicyExposureCardCustomer({ hasLinkedPolicy, exclusionReason, openAr }) → boolean
```

**Single primary seam:** all KPI surfaces (portfolio summary, customer dashboard KPIs, gap writers, term-breach resolver, notification evaluator, policy trend snapshots, golden harness) call **`isUncoveredExposureCustomer`** (and card-specific helper for No Policy Exposure card/report only). Do not fork parallel SQL predicates.

### Uncovered exposure — unified KPI semantics

| Surface | No linked policy | Excluded (any reason) | Credit hold / Insurer declined / Other |
|---------|------------------|----------------------|----------------------------------------|
| Capacity gap KPI | **0** | **0** | **0** |
| Customer detail Terms Breach | **Full open AR** | **Full open AR** | **Full open AR** |
| Portfolio Terms Breach card | **Hidden** | **Hidden** | **Hidden** |
| At-risk / not-insured | **Full AR** | **Full AR** | **Full AR** |
| No Policy Exposure card | **Yes** | **Pending review only** | **No** (policy-risk) |
| Gap writers | **Skip → zero** | **Skip → zero** | **Skip → zero** |
| Notifications | **Suppressed** | **Suppressed** | **Suppressed** |
| `ctv_customer_excluded_from_policy` on invoices | **`false`** | **`true`** when reason set at stamp | **`true`** when reason set at stamp |

### Term breach resolver

One customer-level function used by customer detail API, customer dashboard KPI service, portfolio per-customer maps, and golden harness:

- If **`isUncoveredExposureCustomer`** → return **sum of open invoice outstanding** (Due + Overdue; same line-outstanding rule as today).
- Else → existing flag-based logic (`reporting_breach`, `ctv_payment_term`, `ctv_customer_overdue_mep`, `ctv_outdated_dcl`, `ctv_invoice_after_policy_end`).

**Portfolio aggregation:** exclude uncovered customers entirely from Terms Breach card totals and breach-by-reason charts (do not sum their full AR into portfolio terms breach).

**At-risk for uncovered:** `full open AR` directly—not `min(AR, gap + breach)`.

### Capacity gap writers

When **`isUncoveredExposureCustomer`**, short-circuit in customer policy gap sync and invoice capacity gap sync:

- Persist **zeros** on `CustomerPolicy` gap fields and invoice `capacity_gap_amount` / `capacity_gap_amount_limit` (mirror outdated DCL `nullGapPayload` / zero pattern).
- Apply even if individual invoices still have a `policy_id` tag.
- Do **not** rely on read-time suppress only (`isPolicyCapacityGapSuppressed` remains as defense in depth).

### Exclusion source of truth (reason-only UX)

**UI:** Remove **Excluded from policy** toggle everywhere. **Clearable Autocomplete** with blank placeholder when not excluded. Allowlist only.

**API:** Customer policy PATCH accepts **`policy_exclusion_reason` only**. Server derives boolean in `CustomerPolicyService.applyActivePolicyPatch`.

**On exclusion set (reason becomes non-empty):** zero gap fields immediately; **do not** set `refreshTermsBreachFlags` / full CTV pipeline on save.

**On exclusion clear or first linked policy:** **lazy cron**—no eager gap/breach recalc on save; UI may show stale values until next job.

**Policy import:** Drop `excluded_from_policy` spreadsheet column; reason column only.

**Report builder:** Remove `excluded_from_policy` boolean from report metadata; keep `policy_exclusion_reason`.

**Policy history grid:** Remove excluded Yes/No column; show reason column.

### Invoice `ctv_customer_excluded_from_policy`

| Aspect | Rule |
|--------|------|
| **Meaning** | Customer had **non-empty `policy_exclusion_reason`** at evaluation/snapshot time—not “uncovered exposure” broadly. |
| **No-policy customers** | Flag stays **`false`**; uncovered exposure is modeled at customer level via helpers, not this column. |
| **KPI usage** | **None**—remove from `invoiceHasTermsBreach`, golden harness breach logic, and portfolio breach aggregations. Portfolio `TERMS_BREACH_OR` already omits it. |
| **When written** | Invoice import/create, `refreshCtvSnapshotsForInvoiceIds`, reporting-breach cron—**not** on exclusion-reason save alone. |
| **When cleared** | `clearCustomerExcludedFromPolicyFlagWhenIncluded` when customer is no longer excluded (`excluded_from_policy` false). |
| **Reports / grid** | Keep as audit column; label unchanged. |

### Deploy datafix (exclusion sync)

One-time script before/at deploy:

1. If `excluded_from_policy = true` and reason empty → set `excluded_from_policy = false`.
2. If `excluded_from_policy = false` and reason non-empty → set `excluded_from_policy = true` (reason wins).
3. All rows: `excluded_from_policy = isCustomerPolicyExcluded(policy_exclusion_reason)`.

Optional follow-up: restamp invoice CTV flags for affected customers via existing refresh paths—not a backfill for auto DCL assignment.

### Auto DCL assignment service

```
autoAssignPendingReviewDcl({
  customerId, accountId, countryId, customerNumber, customerNumberPolicy?, modifiedBy?
}) → { assigned: boolean; skippedReason?: enum }
```

**Run when:** customer **create** on account with `has_credit_insurance = true`.

**Skip when (silent):** not exactly one active Primary; customer already has active linked policy; customer already has active **Named** assignment.

**On assign:** DCL row on Primary, normal prefill, `policy_exclusion_reason = "Pending review"`, derived `excluded_from_policy = true`, then post-assignment sync (gap pipeline will short-circuit to zeros per uncovered rules).

**Entry points:** customer upsert create branch; customer import after insert.

### No Policy Exposure dashboard semantics

| Metric | Rule |
|--------|------|
| Card count / amount | **Card cohort** only (no linked policy or pending-review; open AR > 0) |
| At-risk allocation | Card cohort + all uncovered excluded → **full open AR** |
| Policy risk exposure | Insured, non-card customers |
| Policy filter active | Card scoped to selected policy—no em-dash |

**Fix existing bug:** `isNoPolicyExposureCohortCustomer` currently treats **any** exclusion as card member; change to **`isNoPolicyExposureCardCustomer`** per table above.

### Terms Breach changes

- Remove **Excluded from policy** from breach-by-reason chart, filter allowlists, and `TermsBreachCountByReason` type consumers.
- Portfolio terms breach: **exclude entire uncovered KPI cohort** from counts and amounts.
- Customer detail: uncovered → **full open AR** on Terms Breach KPI card.
- Golden harness / `customerKpiSnapshot`: use term breach resolver; **do not** treat `ctv_customer_excluded_from_policy` as breach input.

### Notifications

While **`isUncoveredExposureCustomer`**, suppress **capacity_gap** and **terms-breach** notification rule evaluation for that customer.

### Dashboard filter

- `includeNoPolicyExposure` boolean, default **`true`**.
- When **`false`**: omit **card cohort** (no-policy + pending-review) from all portfolio summary fields.
- Uncovered KPI math unchanged; filter controls card cohort visibility on dashboard aggregates.

### No Policy Exposure report

- Report type: `no_policy_exposure`.
- **Card cohort** rows only.
- Columns: customer name, customer number, open AR, exclusion reason (blank for true no-policy), policy number (blank when none).
- Respects policy scope, business-unit filter, search, pagination, `includeNoPolicyExposure`.

### Snapshot / history

Forward-looking new cohort definitions; no historical snapshot backfill unless requested.

### Architectural seams (testing & integration)

**Primary seam (one):** shared **`isUncoveredExposureCustomer`** + **term breach resolver** + **gap writer short-circuit**—consumed by credit dashboard summary, customer dashboard KPIs, gap sync pipeline, notification evaluator, policy trend snapshots, and golden harness.

**Secondary seam:** `policyExclusion` helpers + `CustomerPolicyService` reason→boolean derivation.

**Tertiary seam:** auto-assign service on customer create only.

Prefer extending existing summary/sync modules over new parallel KPI pipelines.

## Testing Decisions

**Principle:** Test **observable behavior** at service boundaries—cohort membership, dollar totals, stored gap fields, counts, skip reasons, reason→boolean derivation, and API response shapes—not internal SQL fragments or component render trees.

### Modules under test

| Area | Behavior to verify |
|------|-------------------|
| `policyExclusion` + uncovered helpers | `isUncoveredExposureCustomer`, `isNoPolicyExposureCardCustomer`, pending-review match |
| Term breach resolver | Uncovered → full AR; insured → flag-based; portfolio excludes uncovered |
| Gap writers | Uncovered → stored zeros on policy + invoice rows; no linked policy with tagged invoices still zeroed |
| Auto-assign service | Happy path + skip paths |
| `CustomerPolicyService` patch | Reason derives boolean; exclusion set zeros gaps without CTV refresh flag |
| Dashboard summary | Card cohort vs uncovered cohort; filter off hides card cohort |
| Customer dashboard KPIs | Uncovered → gap 0, breach = AR, at-risk = AR |
| Terms breach portfolio agg | Uncovered customers absent from totals |
| Invoice CTV | Reason → true at stamp; no-policy → false; not used in KPI resolver |
| Notifications | Suppressed for uncovered |
| Report handler | `no_policy_exposure` returns card cohort rows |
| Policy import | Reason-only column |
| Datafix | Orphan reconciliation |

### Prior art

- `creditInsuranceDashboardService` gap/at-risk unit tests
- `creditDashboardSnapshotService` snapshot tests
- `policyGapAmounts` excluded suppress tests
- `customerKpiSnapshot` / golden harness tests
- `ImportPolicyService` / `CustomerPolicyService` policy assignment tests
- `invoiceInsuranceFields` CTV tests
- `NamedPolicyAssignmentService` skip/assign tests

### Suggested test units

1. **Uncovered helper** — no linked policy → uncovered; any exclusion reason → uncovered; linked + no reason → not uncovered.
2. **Card helper** — pending-review → card; credit-hold → not card; no-policy → card.
3. **Term breach resolver** — uncovered → sum open AR; insured with flags → flag sum; portfolio map omits uncovered.
4. **Gap writer short-circuit** — uncovered customer → policy + invoice gaps zeroed.
5. **Patch on exclusion set** — gaps zeroed; no `refreshTermsBreachFlags`.
6. **Customer detail KPI** — no-policy and excluded → breach = AR, gap = 0.
7. **Auto-assign** — happy path + skips.
8. **Filter off** — card cohort hidden from summary.
9. **CTV stamp** — reason at snapshot → true; no-policy → false; resolver ignores flag.
10. **Notifications** — no fire when uncovered.
11. **Lazy transition** — clear exclusion without cron → stale until job (document expected behavior).

Integration (optional): create customer on CI account → DCL pending review row; assert uncovered KPI shape.

## Out of Scope

- Dropping `excluded_from_policy` or `ctv_customer_excluded_from_policy` columns from schema.
- Account-level configurable exclusion reason lists (v1 hardcoded allowlist).
- Backfill / auto DCL for **existing** customers without policy.
- Manual customer create API (wire when implemented).
- Lazy assignment on first open AR or invoice ingest.
- Customer detail default tab / no-policy empty state (see `customer-dashboard-no-policy-ux` PRD).
- Recomputing historical credit dashboard snapshot rows retroactively.
- ClickUp issue creation (use **`/to-issues`** separately).
- Eager gap/breach recalc on exclusion clear or first policy assignment.

## Further Notes

### Decision log (grill-me)

#### Portfolio dashboard & auto-assign

| # | Topic | Decision |
|---|-------|----------|
| D1 | Card membership | No linked policy **or** pending-review exclusion only |
| D2 | DCL policy pick | Exactly one active Primary; else skip |
| D3 | Timing | Forward-only on customer create |
| D4/D13 | Named skip | Active `CustomerPolicy` with `limit_type = Named` |
| D5 | Filter scope | Whole dashboard (card cohort) |
| D6 | Terms Breach portfolio | Remove excluded bar; omit **entire uncovered cohort** |
| D7 | At-risk | Full open AR for uncovered |
| D9 | Ambiguous Primary | Skip silently |
| D10 | Filter default | With excluded |
| D11/D18 | Filter off | Hide card cohort from all portfolio KPIs |
| D12 | Other exclusions | Policy-risk only; not on card; same uncovered KPI rules |
| D14 | Create hooks | Upsert create + import service |
| D15 | Report | Customer-level rows; **card cohort** |
| D19 | Auto DCL fields | Normal DCL prefill + Pending review |
| D20 | Policy filter on card | Show scoped card cohort |

#### Exclusion reason-only UX

| # | Topic | Decision |
|---|-------|----------|
| E1 | Storage | Keep `excluded_from_policy`; derive from non-empty reason |
| E2 | Empty state | Blank placeholder |
| E3 | Policy import | Reason column only |
| E4 | API PATCH | `policy_exclusion_reason` only from clients |
| E5/E12 | Datafix | One-time on deploy; reason wins |
| E6 | Invoice CTV | Derive from reason at snapshot; audit-only for KPIs |
| E7 | Report builder | Remove boolean; keep reason |
| E8 | Clear UX | Clearable Autocomplete |
| E9 | Helper | Shared `isCustomerPolicyExcluded` |
| E10 | UI surfaces | Remove toggle everywhere |
| E11 | Filter copy | With/Without excluded customers |

#### Uncovered exposure gap & breach (grill-me session 2)

| # | Topic | Decision |
|---|-------|----------|
| U1 | KPI cohort | No linked policy **or** any non-empty exclusion reason |
| U2 | Without policy definition | No active linked `insurance_policy_id` |
| U3 | Capacity gap writers | Skip; persist zeros (like outdated DCL) |
| U4 | Customer term breach | Full open AR while uncovered |
| U5 | Portfolio Terms Breach | Omit uncovered cohort entirely |
| U6 | Customer detail breach | Full open AR (uncovered) |
| U7 | On exclusion set | Zero gaps; no CTV refresh on save |
| U8 | On clear / first policy | Lazy cron; accept stale KPIs |
| U9 | Scope | Per customer only |
| U10 | Notifications | Suppress capacity_gap + terms-breach while uncovered |
| U11 | Card vs KPI cohort | **Split**—card narrower (D1); KPI broader (U1) |

#### `ctv_customer_excluded_from_policy` (grill-me session 3)

| # | Topic | Decision |
|---|-------|----------|
| C1 | No-policy invoices | Flag stays **false** |
| C2 | Meaning | Non-empty exclusion reason at snapshot time only |
| C3 | KPI role | **Audit/report only**—not breach resolver input |
| C4 | Stamp timing | Invoice events + cron; not exclusion save alone |
| C5 | Reports/grid | Keep column |

### Translations

New strings for filter labels, dropdown options, report title, updated No Policy Exposure tooltip, removal of toggle copy. **Do not modify locale files without explicit user approval**—list keys in implementation PR.

### Related work

- **Customer dashboard no-policy UX** — per-customer tab empty state; this PRD covers KPI math and portfolio dashboard.
- **Import policy PRD** — drop `excluded_from_policy` import column when this ships.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp ARchaser list. **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Excluded Customers from Policy](https://app.clickup.com/t/869dycrat)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Policy exclusion foundation — helper, write derive, datafix, CTV | [869e14nvm](https://app.clickup.com/t/869e14nvm) | — | 15–17, 22, 29–30, 37 |
| 2 | Exclusion reason dropdown — customer UI + policy import | [869e14nwb](https://app.clickup.com/t/869e14nwb) | 1 | 15–18, 28 |
| 3 | Auto DCL pending review on customer create | [869e14ny3](https://app.clickup.com/t/869e14ny3) | 1 | 1–5, 21, 25 |
| 4 | Terms Breach — remove excluded-from-policy category | [869e14nzv](https://app.clickup.com/t/869e14nzv) | 1 | 9, 27 |
| 5 | No Policy Exposure dashboard cohort, card, and filter | [869e14p1g](https://app.clickup.com/t/869e14p1g) | 1, 7 | 6–8, 12–14, 23, 26 |
| 6 | No Policy Exposure report and card drill-down | [869e14p3h](https://app.clickup.com/t/869e14p3h) | 5 | 10–11, 12 |
| 7 | Uncovered exposure — classification helpers and gap writer short-circuit | [869e2p5g0](https://app.clickup.com/t/869e2p5g0) | 1 | 22, 31, 33, 35, 37, 39 |
| 8 | Term breach resolver — uncovered full AR, portfolio omission, notifications | [869e2p5gk](https://app.clickup.com/t/869e2p5gk) | 7 | 9, 32, 34, 36, 38, 40 |

**Assignee / status:** Nilotpal Bose (`93674717`) on all slices; Selected for Development

_Slices 2–4 and 7 can run in parallel after slice 1. Slice 5 needs slice 7 (card helper). Slice 8 needs slice 7. Slice 6 needs slice 5._
