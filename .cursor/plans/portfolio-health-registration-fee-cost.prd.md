# Portfolio health registration fee cost — PRD

Status: ready-for-agent

## Problem Statement

Credit Portfolio Health → Costs & Effectiveness already prices **Policy cost**
with method-aware range math (Actual Sales issued amounts × Insurance Fee
Rate, Limit day-slices × rate / 365, plus amortized top-ups). Policies also
store **Registration Fee (%)** (`registration_fee_percent`), meaning an
**additional cost equal to that percent of the insurance premium** — not a
second percent of sales or limit.

That registration markup is **not** included in Portfolio Health period or
monthly Policy cost today. Analysts therefore understate coverage cost when
registration is configured. Monthly bar tooltips also show only a single
total, so insurance vs registration vs top-ups cannot be inspected.

Separately, the customer dashboard daily insurance cost KPI/chart is already
hard-disabled (`showDailyInsuranceCostChange = false`) but dead code remains.
Customer-level “cost per customer” for Actual Sales is intended to move to
**Report Builder formulas**, not a revival of that chart.

## Solution

1. **Registration markup on Portfolio Health range cost** — For each
   insurance premium slice produced by the active cost method that day /
   invoice date:
   `registrationCost = insurancePremium × registration_fee_percent / 100`.
   Add it into period Policy cost and monthly totals. **Do not** apply
   registration to top-up amortization.

2. **As-of history** — Use that day’s `CustomerPolicyTrend.registration_fee_percent`
   (same as-of rule as `cost_percent`). If null/missing → treat as **0**
   (no fallback to today’s master policy).

3. **Method XOR** — A given customer-day / invoice uses Limit **or** Actual
   Sales, never both. Registration rides only on whichever premium that
   method produced.

4. **Effective cost** — Keep
   `periodCost ÷ average daily compliant exposure` with the new (higher)
   period numerator.

5. **Monthly bar UI** — Keep a **single** bar height = total monthly cost.
   Tooltip breaks down: **Insurance fee**, **Registration fee**, **Top-ups**,
   **Total**.

6. **Copy** — Clarify Registration Fee (%) help (settings/policy), Costs tab
   Policy cost / monthly help, and report formula hints/examples so
   registration means **% of insurance premium** (D1), not % of invoice
   amount alone. Recommended Actual Sales fee formula:
   `[Invoice.amount] * [Customer.cost_percent] * [Customer.registration_fee_percent]`
   (rates auto-scale ÷100 in the formula engine).

7. **Cleanup** — Remove dead customer daily-cost KPI/chart front-end code.
   Keep CPT daily cost storage and report `*_daily_cost_change` fields for
   now.

## User Stories

1. As a credit analyst, I want period Policy cost to include registration as
   a percent of the insurance premium, so that Costs & Effectiveness matches
   how registration is priced.

2. As a credit analyst, I want registration applied only for the active cost
   method (Limit or Actual Sales) on that day/invoice, so that method flips
   stay correct.

3. As a credit analyst, I want top-up amortization unchanged by registration,
   so that fixed top-up premiums are not marked up.

4. As a credit analyst, I want registration % taken as of the Limit day or
   invoice issue day from history, so that later policy edits do not rewrite
   past months.

5. As a credit analyst, I want missing historical registration % to add zero,
   so that sparse history does not invent a rate.

6. As a credit analyst, I want Effective cost to use the updated period cost
   numerator automatically.

7. As a credit analyst, I want monthly bars to keep one total height, with a
   tooltip listing insurance, registration, top-ups, and total.

8. As a credit analyst, I want Policy cost and monthly chart help text to
   mention registration markup, so that the UI matches the math.

9. As a policy admin, I want Registration Fee (%) field help to say it is a
   percent of the insurance premium (fee rate result), so that I do not
   confuse it with a percent of sales/limit.

10. As a report editor building customer cost, I want formula hints/examples
    aligned with Portfolio Health (fee = premium × registration%), so that
    reports and the Costs tab agree.

11. As a developer, I want dead customer daily-cost dashboard UI removed,
    so that hidden KPI/chart code is not maintained.

12. As a product owner, I want CPT daily cost storage left in place for now,
    so that we can retire storage later after formula reports prove enough.

13. As a QA engineer, I want unit tests on the range-cost seam for
    registration markup, null→0, method XOR, and monthly components, so that
    regressions are caught without UI drives.

## Implementation Decisions

- **Surface** — Portfolio Health Costs & Effectiveness: `periodCost`, monthly
  points + tooltip, Effective cost, related help copy. Plus settings/
  registration field help and report formula hint/example alignment.
- **Primary seam** — Extend `portfolioRangeCost.ts` /
  `computePortfolioRangeCost` (and day-row input type) so each Limit /
  Actual Sales premium slice also produces a registration slice; bucket
  insurance / registration / top-up separately for monthly (and sum into
  period total). Wire `fetchPortfolioRangeCostInputs` to SELECT and map
  `registration_fee_percent`.
- **Math** —
  - Insurance (unchanged): Actual Sales `(amount × cost%) / 100`; Limit
    `(limit × cost%) / 100 / 365`.
  - Registration: `insurancePremium × registrationFeePercent / 100` when
    registrationFeePercent is finite; else 0.
  - Top-ups: unchanged amortized slices.
  - `total = insurance + registration + topUps` for period and each month.
- **API contract** — Extend monthly points beyond `totalCost`, e.g.
  `insuranceCost`, `registrationFeeCost`, `topUpCost`, `totalCost`. Period
  KPI may remain a single `periodCost` (folded total). Keep existing
  approval, policy filter, BU scope, and excluded invoice statuses from
  range-cost PRD.
- **UI** — `CostsSectionView` monthly tooltip shows four lines (three parts +
  total). Prefer reusing/extending `ChartTooltip` with explicit rows rather
  than inventing stacked bars. Always show the three parts + total (zeros
  allowed) unless implementation finds empty tooltips unusable — default
  show zeros.
- **Customer cleanup** — Remove
  `CustomerDashboardDailyCostChart`, daily-cost view-model usage, and the
  `showDailyInsuranceCostChange` gated block from `CustomerDashboardCards`
  (and unused labels/imports). Do not change snapshot writers.
- **i18n** — Update EN/HE keys for settings registration help, dashboard
  Costs help, and reports formula hint/example text (**requires translation
  permission** at implement time).
- **No schema migration** — `registration_fee_percent` already exists on
  policy / CPT history.

## Testing Decisions

- **Seam:** `computePortfolioRangeCost` / related pure helpers (extend
  `tests/backend/api/portfolio-range-cost.test.ts` or package-local equivalent).
- Assert: registration = premium × rate; null registration → 0; Limit and
  Actual Sales each markup their own premium; top-ups not marked up; monthly
  component sums equal `totalCost`; Effective cost wiring still uses period
  total.
- FE: tooltip receives component fields (unit or shallow contract on monthly
  mapping) only if the team already tests Costs UI that way — prefer backend
  seam first.
- Do **not** add new customer dashboard daily-cost tests; delete/adjust only
  what breaks after FE removal.

## Out of Scope

- Rewriting stored CPT `policy_daily_cost` / `top_up_daily_cost` /
  `total_daily_cost` (or deltas) to include registration.
- Removing report metadata fields `*_daily_cost_change`.
- Stopping snapshot cost computation/persistence.
- Stacked monthly bars (tooltip breakdown only).
- Changing deductible N/A card or other Costs KPIs unrelated to policy cost.
- FX / multi-currency beyond existing range-cost rules.
- Auto-seeding system reports with Premium/Fee formulas (editors configure
  formulas; we only align hints/examples).

## Decision log (grill-me)

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | How registration fee adds | Extra = insurance premium × registration% / 100 | Markup on method-based premium |
| D2 | Which costs get the surcharge | Active method only (Limit **or** Actual Sales); not top-ups | Method-aware per day/invoice |
| D3 | Costs tab presentation | Fold into Policy cost / monthly / Effective cost; bar tooltip breaks down | Single bar height |
| D4 | Monthly bar tooltip | Insurance fee + Registration fee + Top-ups + Total | Monthly component fields |
| D5 | Which registration % | As-of that day from history; null → 0 | CPT `registration_fee_percent` |
| D6 | Where registration applies | Portfolio Health Costs only; remove dead customer daily-cost UI | No registration on customer daily cost |
| D7 | How far to remove | Front-end only; keep storing daily cost; customer cost via formulas later | Safe cleanup |
| D8 | Report formulas vs PH math | Same as D1; recommend amount × cost% × registration% for fee | Align formula docs |
| D9 | Field / help copy | Clarify in settings, PH cost help, report hints | Translation permission |
| D10 | Plan home | This new PRD; references range-cost PRD | Do not reopen range-cost grill |

## Codebase scan

### Required

| Area | Path(s) | Why |
|------|---------|-----|
| Range cost math | `api/src/credit-insurance/domain/portfolioRangeCost.ts` | Add registration slice + monthly components |
| Range cost fetch | `creditPortfolioHealthService.ts` (`fetchPortfolioRangeCostInputs`) | SELECT/map `registration_fee_percent` |
| Costs section build | `buildCostsSection` / `getCreditPortfolioHealth` in same service | Pass through monthly components |
| API/FE types | frontend `types/creditInsurance.ts` (+ any shared DTO) | Extend `PortfolioCostMonthlyPoint` |
| Costs UI | `CostsSectionView.tsx`, possibly `ChartTooltip.tsx` | Tooltip breakdown |
| Range cost tests | `tests/backend/api/portfolio-range-cost.test.ts` | Registration cases |
| Customer FE cleanup | `CustomerDashboardCards.tsx`, `CustomerDashboardDailyCostChart.tsx`, `customerDashboardDailyCostViewModel.ts` | Remove dead UI |
| Settings help | `locales/en|he/settings.json` (`tooltips.registration_fee_percent`) | D9 |
| Costs help | `locales/en|he/dashboard.json` (period/monthly cost help keys) | D9 |
| Formula hints | `locales/en|he/reports.json`, `FormulaUpsertModal.tsx` defaults, `validateFormulaDraft.ts` default strings if any | D8/D9 |

### Optional / out of scope unless requested

| Area | Why |
|------|-----|
| Report metadata `*_daily_cost_change` | Leave until formula reports replace usage (D7) |
| `customerPolicyDailyCost.ts` / delta writers | Storage unchanged |
| Report-builder formula PRD body | Follow-up doc sync; this PRD owns the aligned example |
| Insurance-policy-pricing PRD | Field already shipped; only help copy |
| Stacked Recharts `<Bar>` stack | Rejected; tooltip only |

### No change needed

| Area | Why |
|------|-----|
| Prisma schema / migrations | `registration_fee_percent` already on policy + CPT |
| Top-up amortization helpers | Registration does not apply |
| Health / No Coverage / Utilization tabs | Unrelated |
| Permission / route for portfolio health | Unchanged |

## Plan improvements / easy to miss

- Day-row type today has `costPercent` but **not** `registrationFeePercent`; SQL omit will silently keep registration at 0.
- Monthly `totalCost` must equal sum of three components (floating tolerance in tests).
- Report formula auto-scale already ÷100 for **both** rates — D1 fee formula multiplies three factors once; do **not** add an extra `/100` in docs.
- Old formula PRD example `amount × registration%` is **wrong** for D1; update hints so editors do not recreate $5,000-on-$10k mistakes.
- Customer cleanup may leave unused i18n keys under `credit_insurance_dashboard.daily_cost_*` — remove only if unused elsewhere; do not expand translation churn beyond D9 keys without permission.
- Styling: reuse existing tooltip/card patterns; no new theme classes without approval.

## Related

- `.cursor/plans/portfolio-health-range-cost.prd.md` (base range-cost math)
- `.cursor/plans/credit-portfolio-health.prd.md` (Costs tab product home)
- `.cursor/plans/report-builder-formula-fields.prd.md` (formula operands; align examples with D8)
- `.cursor/plans/insurance-policy-pricing-fields.prd.md` (registration field introduction)

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under
`.cursor/plans/portfolio-health-registration-fee-cost/`. **Hard blockers**
are recorded in each slice's **Blocked by** header. Implement in dependency
order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/portfolio-health-registration-fee-cost/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Range-cost registration markup + monthly components | `issues/01-range-cost-registration-components.md` | — | 1–6, 13 |
| 2 | Costs UI tooltip + help copy | `issues/02-costs-ui-tooltip-help.md` | 01 | 7–8 |
| 3 | Settings + report formula hint alignment | `issues/03-settings-report-formula-copy.md` | — *(parallel OK)* | 9–10 |
| 4 | Remove customer daily-cost FE | `issues/04-remove-customer-daily-cost-fe.md` | — *(parallel OK)* | 11–12 |

**Status:** `ready-for-agent` on all slices.
