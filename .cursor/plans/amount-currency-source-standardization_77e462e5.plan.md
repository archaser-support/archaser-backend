---
name: amount-currency-source-standardization
overview: Standardize financial display logic so amount and currency are always sourced from the same data context, prioritizing Customer table values for customer-level summaries while preserving row-level and period-level correctness.
todos:
  - id: define-source-contract
    content: Finalize amount+currency source ownership rules and baseline mismatches
    status: completed
  - id: build-resolver
    content: Implement shared amount-currency pair resolver and tests
    status: completed
  - id: phase2-critical
    content: Refactor portal page, portal home, and customer header to pair-safe mapping
    status: completed
  - id: phase3-dashboard
    content: Align dashboard API and dashboard/chart-detail consumers
    status: completed
  - id: phase4-secondary
    content: Refactor secondary modules and aggregated customer views
    status: completed
  - id: phase5-guardrails
    content: Clean long tail, enforce checks, and add fallback telemetry
    status: completed
  - id: phase6-guardrails
    content: Add static checks and enforce resolver-only USD fallback policy
    status: completed
isProject: false
---

# Amount + Currency Source Standardization Plan

## Goal

Prevent financial mislabeling by enforcing **source-pair integrity**: every displayed amount must use its matching currency from the same source context.

## Current Status (Updated)

- `phase2-critical` is now completed with corrected customer header currency precedence for account-normalized totals.
- `phase5-guardrails` is completed by removing remaining inline `|| "USD"` fallbacks from app/api/server runtime code paths.
- `phase6-guardrails` is completed via `scripts/check-currency-fallbacks.js` and npm script wiring (`check:currency-fallbacks`) enforced in `pre-commit` and `validate:all`.

## Canonical Source Rules

- **Customer-level summaries**: amount + currency from `Customer` table fields first (`customer_due_amount1/2` with `customer_due_currency1/2`).
- **Invoice/payment rows**: amount + currency from row fields first.
- **Collection period widgets**: use `CustomerCollectionPeriod` only for true period/phase metrics (never as default source for customer summary totals).
- **Account-level aggregates**: use account-normalized amount + account currency.
- **USD fallback**: only as last resort in one shared resolver.

## Immediate Scope Clarification

- The portal fallback introduced in commit `6aa7e668962fb976ea6b9b8871ade535bc476594` is the first correction target.
- Replace collection-period-first fallback in:
  - `app/[locale]/portal/[customerUUID]/page.tsx`
  - `app/[locale]/portal/[customerUUID]/PortalHome.tsx`
- New target order for customer-summary displays:
  1. `Customer` amount+currency pair
  2. `CustomerCollectionPeriod` pair (only if customer pair missing)
  3. `Account` currency with explicit fallback handling
  4. Terminal `"USD"` in resolver only

## Phase 0 - Contract and Baseline

- Define and freeze source ownership rules for each metric family.
- Inventory current mismatches where amount and currency come from different sources.
- Identify direct `|| "USD"` usage outside shared formatting/resolver utilities.

## Phase 1 - Shared Resolver Foundation

- Introduce shared resolver helpers for:
  - `resolveAmountCurrencyPair(metricContext)`
  - row-level currency resolution
  - centralized terminal USD fallback
- Add unit tests for precedence and pair integrity.
- Keep behavior unchanged in UI until Phase 2.

## Phase 2 - Critical Customer-Facing Surfaces

- Update [d:/Cloudial/archaser/app/[locale]/portal/[customerUUID]/page.tsx](d:/Cloudial/archaser/app/[locale]/portal/[customerUUID]/page.tsx)
  - Make `customerDetails` source customer-table **amount+currency pairs** for customer-level totals first.
  - Remove collection-period-first ordering from commit `6aa7e668962fb976ea6b9b8871ade535bc476594`.
- Update [d:/Cloudial/archaser/app/[locale]/portal/[customerUUID]/PortalHome.tsx](d:/Cloudial/archaser/app/[locale]/portal/[customerUUID]/PortalHome.tsx)
  - Replace ad hoc fallback chains with resolver outputs.
  - Ensure each amount block uses matching currency source (pair integrity).
  - Remove `fallbackDisplayCurrency` logic that can pair mismatched amount source with currency source.
- Update [d:/Cloudial/archaser/app/[locale]/app/customers/[customerId]/CustomerHeader.tsx](d:/Cloudial/archaser/app/[locale]/app/customers/[customerId]/CustomerHeader.tsx)
  - Align summary cards to customer-table-first pair mapping for both amount and currency.

## Phase 3 - Dashboard and Chart Details

- Update [d:/Cloudial/archaser/pages/api/system/[...path].ts](d:/Cloudial/archaser/pages/api/system/[...path].ts)
  - Return explicit source-context fields for aggregates.
- Update dashboard consumers:
  - [d:/Cloudial/archaser/app/[locale]/app/dashboard/DashboardGrid.tsx](d:/Cloudial/archaser/app/[locale]/app/dashboard/DashboardGrid.tsx)
  - [d:/Cloudial/archaser/app/[locale]/app/dashboard/chart-details/page.tsx](d:/Cloudial/archaser/app/[locale]/app/dashboard/chart-details/page.tsx)
  - [d:/Cloudial/archaser/app/[locale]/app/dashboard/chart-details/columnDefinitions.tsx](d:/Cloudial/archaser/app/[locale]/app/dashboard/chart-details/columnDefinitions.tsx)
- Preserve account-level aggregate semantics where data is account-normalized.

## Phase 4 - Secondary Modules

- Normalize disputes/legal/agents/promise-to-pay stats and lists to pair-safe resolution.
- Update customer aggregated views:
  - [d:/Cloudial/archaser/app/[locale]/app/customers/[customerId]/CustomerAggregatedDataTab.tsx](d:/Cloudial/archaser/app/[locale]/app/customers/[customerId]/CustomerAggregatedDataTab.tsx)
- Ensure invoice/list rows still prioritize row currency.

## Phase 5 - Long Tail Cleanup

- Refactor control-center/admin/import screens with remaining mixed-source fallbacks.
- Remove inline `|| "USD"` where shared resolver is available.
- Document intentional exceptions (if any).

## Phase 6 - Guardrails

- Add static checks / CI guard against new inline USD fallbacks outside resolver.
- Add PR checklist item: amount-currency pair integrity verified.
- Add lightweight telemetry for fallback-tier usage.

## Testing Strategy

- **Unit**: precedence matrix, pair matching, missing currency fallback.
- **Component**: portal hero + customer header single/multi-currency scenarios.
- **Integration**: dashboard/chart-details consistency with API-provided source context.
- **Regression**: verify no amount renders with mismatched currency.
- **Commit-focused regression**: verify the fallback behavior changed by `6aa7e668962fb976ea6b9b8871ade535bc476594` now resolves customer-table pairs first in portal summary displays.

## Rollout

- Deliver in small PRs by phase (P0 surfaces first).
- Smoke-test after each phase on portal, customer header, dashboard cards, chart details.
- Keep rollback-safe by avoiding broad cross-module refactors in one PR.

