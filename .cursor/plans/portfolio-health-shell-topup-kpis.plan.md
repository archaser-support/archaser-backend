# Portfolio Health + CDP: shell-owned top-ups

After copy-to-shell (connect + 10149 lift), extra cover lives on the **shell’s** `CustomerTopUp` rows. Dashboards must not merge child Customer Policy Trend (CPT) top-up amounts. Shared live extra cover still walks to the **top** parent (`resolveTopUpOwnerCustomerId`). This round is Portfolio Health plus Credit Dashboard Daily Snapshot (CDP) top-up cards.

**Related:** `.cursor/plans/parent-customer-credit-pool.prd.md`, `.cursor/plans/lift-child-topups-to-shell-10149.plan.md`

## Decision log (grill 2026-10-06)

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Extra cover source | Shell `CustomerTopUp` / shell CPT only — drop child merge | Store of record is the shell; child CPT amounts double or mix history |
| D2 | Screens this round | Portfolio Health + CDP top-up cards (root-only) | CDP `fetchTopUpSnapshotAgg` has no parent filter |
| D3 | Old Portfolio days | Overlay also stamps extra cover + effective limit from **this shell’s** top-up rows | Overlay already runs on snapshot / parent-link / as-of; AR was written without cover |
| D4 | Usage percents | Recompute `policy` / `top_up` / `effective` usage percents on the same overlay write | Top 10 prefers stored `effective_usage_pct` |
| D5 | Child-day query | Remove the whole descendant merge in `fetchLinkedCptCustomerDaySeries` | Overlay is the pool-AR source; no synthetic shell days |
| D6 | Who | Every credit-insurance account | Overlay is already account-agnostic |
| D7 | Nested shell overlay | This shell’s own top-up rows only | Mid-level with no rows → $0 extra cover on overlay |
| D8 | Live extra-cover math | Unchanged — still the top parent | Out of D2 scope; Portfolio already lists `parent_customer_id IS NULL` only |

## What to build

1. **Revert** leaf→shell read merge in `fetchLinkedCptCustomerDaySeries` (roots-only SQL, no descendant CTE, no synthetic days).
2. **Overlay stamp** in `overlayPoolCapacityGapAndAtRiskOnTrends`: for each shell day, resolve extra cover from **that shell’s** active `CustomerTopUp` (same day window as existing top-up helpers), set `top_up_total`, `effective_approved_limit` (policy + extra cover), and usage percents from overlaid `usage_amount` vs those limits. Do **not** walk to the top parent here (D7). Do **not** copy child CPT `top_up_total`.
3. **CDP** `fetchTopUpSnapshotAgg`: `Customer.parent_customer_id` null (same root filter as Portfolio). Cover totals and unique customers then count standalones + top shells only.

No schema / i18n / UI copy unless a string already claims “includes child cover” and becomes wrong.

## How to test

1. Shell with its own top-up + linked stores: Portfolio Top-up draw, daily util top-up line, Top 10 violet segment, top-up **count**, and costs top-up stack follow the **shell** row, not the stores.
2. Nested Region under Holding: overlay on Region uses Region’s top-up rows only (often none). Live Holding extra cover unchanged.
3. Credit Dashboard top-up card: linked children with leftover live copies do not add customers or cover.
4. Regular (no parent) customer with a top-up: all of the above unchanged.

## Codebase scan

**Required**

- `packages/credit-insurance-domain/.../linkedCptCustomerDaySeries.ts` — revert descendant merge
- `packages/credit-insurance-domain/.../syncCreditPoolPolicyTrendsAfterParentChange.ts` — overlay stamp limits + percents (`computeTopUpUsageMetrics`)
- `packages/credit-insurance-domain/.../creditDashboardSnapshotService.ts` — `fetchTopUpSnapshotAgg` roots only
- Reuse: `resolveEffectiveApprovedLimitFromTopUpRows` / `isActiveTopUp` on **this** `customer_id`, not `resolveTopUpOwnerCustomerId`

**Optional / out of scope unless requested**

- Customer Dashboard live cards (D8)
- Connect remirror D1t–D8t (product PRD; not this KPI pass)
- Customer-grain top-up expiring reports
- New tests (not requested)
- Re-enqueue as-of for 10149 (lift already does; overlay stamp applies on the next rewrite)

**No change needed**

- `fetchPeriodTopUpUniques` / costs `CustomerTopUp` — already scoped to Portfolio roots
- `resolveEffectiveApprovedLimit` live walk to top parent (D8)
- Frontend Portfolio/CDP chart components — consume existing fields
- Prisma schema / translations (unless help text still says child cover is merged)

## Blocking / informational gates

| Gate | If Yes | If No |
|------|--------|-------|
| 10149 as-of job already drained (informational) | Old shell CPT days already have AR overlay; stamp applies on next overlay | Old days stay $0 extra cover until history rewrite runs overlay |

## Suggest plan improvements

- Overlay must use **this shell’s** top-ups (D7) even though live math uses the top parent — document that nested Dashboard trend can disagree with live cards until a later slice.
- Recompute percents with the same helper as CPT stamp (`computeTopUpUsageMetrics`) so Top 10 bars match draw math.
- Do not SUM child `CustomerTopUp` in CDP even after root filter if a standalone and a shell both have rows — that is correct (two roots).
