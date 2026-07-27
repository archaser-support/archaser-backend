---
name: customer-dashboard-no-policy-ux
overview: Show a no-policy empty state on the customer Dashboard tab when credit insurance is enabled but the customer has no linked policy, and default dual-product accounts without a policy to Activities instead of a blank Dashboard.
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869dw41gf
isProject: false
---

# Customer Dashboard — No-Policy Empty State & Default Tab

## Problem Statement

On the customer detail screen, users with a **credit insurance** product open the **Dashboard** tab and see a **blank area** when the customer has **no linked insurance policy**. There is no guidance on why metrics are missing or what to do next.

For **dual-product** accounts (collection + credit insurance), landing on Dashboard by default is a poor experience when the customer has no policy — credit metrics are unavailable, while **Activities** is immediately useful.

Users need clear feedback on credit-only and dual-product accounts, and sensible default navigation when credit dashboard content cannot be shown.

## Solution

1. **Dashboard empty state** — When the account has credit insurance and the customer has **no linked insurance policy** (`getEffectivePolicyId` is null), show a centered empty state on the Dashboard tab (icon, title, description), matching the Activities “no activities yet” pattern. No CTA button.

2. **Default tab routing** — When the account has **both** products and the customer has **no linked policy**, default to **Activities** on first load (no `?tab=`). Credit-only accounts with no policy still default to **Dashboard** so users see the message. Parent customers (`hasChildren`) keep **Aggregated Data** as the highest-priority default. Explicit `?tab=` in the URL is always respected.

3. **Translations** — New EN/HE strings under credit insurance copy for title and description.

## User Stories

1. As a credit-only account user, I want to see a clear message on Dashboard when a customer has no linked policy, so that I understand why credit metrics are missing.

2. As a credit-only account user, I want to land on Dashboard by default for customers without a policy, so that I see that message immediately.

3. As a dual-product account user, I want to land on Activities by default when a customer has no linked policy, so that I see useful content instead of an empty Dashboard.

4. As a dual-product account user, I want to still open Dashboard manually and see the no-policy message, so that I understand why credit metrics are unavailable.

5. As a dual-product account user with a customer who **has** a linked policy, I want to land on Dashboard by default, so that credit KPIs remain the primary entry point.

6. As a collection-only account user, I want customer detail behavior unchanged, so that I am not affected by credit-insurance logic.

7. As a user who bookmarks `?tab=dashboard`, I want that tab to open even when the customer has no policy, so that shared links and navigation intent are honored.

8. As a user who bookmarks `?tab=activities`, I want Activities to open regardless of policy state, so that deep links work consistently.

9. As a parent-account user (customer with children), I want to keep landing on Aggregated Data when no `?tab=` is set, so that existing parent workflow is preserved.

10. As a Hebrew-speaking user, I want the no-policy empty state in Hebrew, so that the experience matches the rest of the app.

11. As an English-speaking user, I want the no-policy empty state in English, so that the experience matches the rest of the app.

12. As a user viewing a customer who gains a linked policy after load, I want Dashboard to show credit metrics on refresh/navigation, so that the empty state disappears when policy is assigned.

13. As a user on the Activities tab, I want the existing empty-state behavior unchanged, so that this feature does not regress activity timeline UX.

14. As a user with credit insurance but a customer who has policy history rows without `insurance_policy_id`, I want the no-policy treatment when there is no effective linked policy, so that semantics match “no policy linked” rather than “no history rows.”

15. As a product owner, I want policy-presence rules centralized, so that Dashboard empty state and default-tab logic stay consistent as the domain evolves.

16. As a developer, I want unit tests on pure decision logic, so that account/product/customer combinations are verified without brittle UI tests.

17. As a user on a credit-only account with a linked policy, I want Dashboard to show credit KPIs as today, so that normal credit workflows are unaffected.

18. As a user navigating between customers, I want default tab logic to re-evaluate per customer, so that one customer’s policy state does not stick for the next.

19. As a user opening customer detail before customer API data returns, I accept a brief Dashboard flash before redirect to Activities (dual-product, no policy), so that implementation stays simple without blocking the whole page.

20. As a user without permission to assign policies, I still want an informational message (no CTA), so that I am not shown actions I cannot perform.

## Implementation Decisions

### Policy presence

- **“No policy”** means `getEffectivePolicyId(customer) == null` — no linked `insurance_policy_id` on the active CustomerPolicy row, no resolvable legacy `policy_id`.
- Introduce **`customerHasLinkedInsurancePolicy(customer)`** as the canonical boolean wrapper (inverse of “no policy”).
- **Do not change** `isCreditDashboardSectionEligible` in this work; it continues to gate KPI/chart rendering (`customerPolicies.length > 0`). Empty state uses the stricter linked-policy rule.

### Dashboard empty state

- Render when: account has **credit insurance** AND `!customerHasLinkedInsurancePolicy(customer)`.
- Applies to **all** credit-insurance accounts (credit-only and dual-product) whenever the Dashboard tab is visible.
- Visual pattern: ActivityTimeline-style — centered icon, title (`dashboard_no_policy_title`), description (`dashboard_no_policy_description`).
- **No CTA** — message only.
- Reuse existing layout tokens (`Box`, `Typography`, theme variants for Hebrew/English); no new global styles or theme entries.

### Default tab routing

| Condition | Default tab (no `?tab=`) |
|-----------|--------------------------|
| Parent (`hasChildren`) | Aggregated Data (unchanged) |
| Dual-product + no linked policy | Activities |
| Credit-only + no linked policy | Dashboard |
| Has linked policy (any credit account) | Dashboard |
| Collection-only | Dashboard (unchanged) |

- Explicit `?tab=` **always wins** — no redirect away from `?tab=dashboard`.
- Post-load **`useEffect`** in customer detail shell when customer + account flags are available (same pattern as parent → Aggregated Data). Brief Dashboard flash before Activities redirect is acceptable.

### Pure resolver (testing seam)

Single seam at the policy-adapter / customer-dashboard decision layer. UI components stay thin adapters.

```typescript
type CustomerDetailDashboardUxInput = {
  customer: CustomerWithPolicyFields | null | undefined
  hasCreditInsurance: boolean
  hasCollection: boolean
  hasChildren: boolean
  explicitTab: string | null | undefined  // URL ?tab= value
}

type CustomerDetailDashboardUx = {
  showDashboardNoPolicyEmptyState: boolean
  defaultTabWithoutUrlParam: 'dashboard' | 'activities' | 'aggregated_data'
}

function resolveCustomerDetailDashboardUx(
  input: CustomerDetailDashboardUxInput
): CustomerDetailDashboardUx
```

**`showDashboardNoPolicyEmptyState`:** `hasCreditInsurance && !customerHasLinkedInsurancePolicy(customer)`

**`defaultTabWithoutUrlParam`:** parent → aggregated; else dual + no policy → activities; else dashboard.

### Modules touched

- **Shared policy adapter / dashboard view-model layer** — `customerHasLinkedInsurancePolicy`, `resolveCustomerDetailDashboardUx`.
- **Customer dashboard cards** — branch: empty state vs existing credit KPI section.
- **Customer detail combined shell** — wire resolver for default tab `useEffect`; pass flags into dashboard cards.
- **Locale files** — `customers.credit_insurance.dashboard_no_policy_title`, `dashboard_no_policy_description` (EN + HE).

### API / schema

- **No API or schema changes.** Customer payload already includes `customerPolicies` and `activeCustomerPolicy`.

### Architectural notes

- UI components remain thin; branching lives in the pure resolver.
- Empty state is **not** tied to KPI eligibility (`isCreditDashboardSectionEligible`) to avoid showing KPI shells with no data while still showing the message when history exists but no link.

### Grill-me decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | “No policy” definition | `getEffectivePolicyId(customer) == null` |
| D2 | Empty-state scope (initial) | Credit-only only — superseded by D11 |
| D3 | Empty-state pattern | ActivityTimeline style (icon, title, description) |
| D4 | CTA | Message only |
| D5 | Dual-product default tab (no policy) | Activities when no `?tab=` |
| D6 | Parent account priority | Aggregated Data still wins |
| D7 | Credit-only default tab (no policy) | Dashboard |
| D8 | Dual-product default (has policy) | Dashboard |
| D9 | Tab-switch timing | `useEffect` after load; brief flash OK |
| D10 | Translations | New EN/HE keys — approved |
| D11 | Dual-product manual Dashboard | Show same no-policy message |

## Testing Decisions

**Principle:** Test **external behavior** through the resolver’s public interface — given customer + account shape, assert empty-state visibility and default tab. Do not assert React render trees or internal `useEffect` ordering.

**Module under test:** `resolveCustomerDetailDashboardUx` + `customerHasLinkedInsurancePolicy`.

**Cases:**

| Scenario | `showEmptyState` | `defaultTab` |
|----------|------------------|--------------|
| Credit-only, no policy | true | dashboard |
| Credit-only, linked policy | false | dashboard |
| Dual, no policy | true | activities |
| Dual, linked policy | false | dashboard |
| Parent, dual, no policy | true | aggregated_data |
| Collection-only | false | dashboard |
| History rows, no `insurance_policy_id` | true | per account rules |
| Legacy `policy_id` only | false | per account rules |

**Prior art:** `customerDashboardCardViewModel` unit tests, `customerPolicyAdapter` unit tests, `isCreditDashboardSectionEligible` tests.

**Out of test scope for unit layer:** URL `?tab=` override (integration/manual), brief tab flash, full ActivityTimeline visual parity.

## Out of Scope

- CTA to General or Policies tab.
- Changing KPI eligibility (`isCreditDashboardSectionEligible`) to use `getEffectivePolicyId`.
- Deferring tab render until customer loads (flash-free).
- Collection KPIs on Dashboard for dual-product customers without policy.
- New global theme/CSS classes.
- ClickUp task creation (explicitly deferred by user for this PRD).
- Backend changes, cron, or report builder fields.

## Further Notes

### Proposed copy (EN)

- **Title:** No Insurance Policy Linked
- **Description:** Link an insurance policy in General settings to view credit metrics on this dashboard.

Hebrew equivalents in `locales/he/customers.json` (approved in grill session).

### Risk

Dual-product users may see a one-frame Dashboard flash before Activities redirect; accepted (D9).

## Issues (vertical slices)

Single end-to-end task published to ClickUp default list (see `.cursorrules`). Start a **fresh session** for implementation.

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Customer dashboard — no-policy empty state & default tab | [869dw41gf](https://app.clickup.com/t/869dw41gf) | — | 1–20 |

**Assignee / status:** Nilotpal Bose (`93674717`); Selected for Development
