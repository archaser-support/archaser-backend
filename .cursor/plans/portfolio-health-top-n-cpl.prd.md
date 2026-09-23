---
name: portfolio-health-top-n-cpl
overview: Add a Portfolio Health top-N Credit Protection Level card (gauge + share metrics, 5/10/20 slider) after Longest over-limit streak, and rename Average portfolio health to Credit Protection Level.
source: grill-me session /start-work
clickup_task_url: https://app.clickup.com/t/869f5hykt
isProject: false
---

# Portfolio Health — Top-N Credit Protection Level

## Problem Statement

On **Portfolio Health**, credit users can see whole-book health (today labeled **Average portfolio health**) and operational KPIs such as **Below threshold %** and **Longest over-limit streak**, but they cannot see how concentrated Credit Protection Level and exposure are in the largest customers.

Product needs a clear answer to: “How healthy and how large is the top of the book?” without leaving the Health tab or opening Utilization. The Credit Dashboard already uses the name **Credit Protection Level** for the same formula; Portfolio Health still says **Average portfolio health**, which splits the vocabulary.

## Solution

On the Portfolio Health **Health** tab:

1. **Rename** the existing whole-book KPI/halo from **Average portfolio health** / **Avg. Health** to **Credit Protection Level** (EN + HE), same formula as today and as the Credit Dashboard gauge.
2. Add a **new card immediately after Longest over-limit streak** that shows, for a selectable top-N cohort:
   - A **Credit Protection Level** gauge for that cohort
   - Three share metrics: **Total Receivable**, **Compliant Exposure**, and **At-Risk Exposure**, each with **share of the portfolio total (%)** (and amounts as needed for clarity)
3. A **slider with steps 5 / 10 / 20** (same interaction pattern as the Below-threshold card), **default 10**. Changing the slider updates the gauge and the three shares **locally** from data already in the Health payload (no refetch).
4. **No new graph lines** on the daily or monthly charts for this feature.

## User Stories

1. As a credit manager on Portfolio Health, I want a Credit Protection Level for the largest customers, so that I can see whether concentration at the top of the book is protected.
2. As a credit manager, I want Total Receivable for the top-N cohort with % of portfolio, so that I know how much of open AR sits in those names.
3. As a credit manager, I want Compliant Exposure for the top-N cohort with % of portfolio, so that I can see how much of protected exposure is concentrated.
4. As a credit manager, I want At-Risk Exposure for the top-N cohort with % of portfolio, so that I can see risk concentration among the largest customers.
5. As a credit manager, I want a gauge for top-N Credit Protection Level, so that I can read the cohort the same way I read the Credit Dashboard gauge.
6. As a credit manager, I want a 5 / 10 / 20 slider on that card, so that I can widen or narrow the concentration lens without changing page filters.
7. As a credit manager, I want the slider to default to 10, so that the first view matches the familiar Utilization top-10 mental model.
8. As a credit manager, I want slider changes to feel instant (no loading flash), so that exploring N is as smooth as changing the Below-threshold cut-off.
9. As a credit manager, I want the new card placed after Longest over-limit streak, so that it sits with the other Health KPI cards in the agreed layout.
10. As a credit manager, I want top-N ranking by mean daily total receivables over the selected date range, so that ranking matches Utilization’s “largest open AR” idea.
11. As a credit manager, I want Credit Protection Level for the cohort computed from aggregated top-N means (compliant ÷ receivable), so that large customers dominate the score instead of an equal average of tiny names.
12. As a credit manager, I want share % computed against the portfolio mean totals for the same filters and range, so that percentages are comparable to the rest of the Health tab.
13. As a credit manager with fewer than N customers in scope, I still want the card to show metrics for all available customers, so that the page never goes blank when the book is small.
14. As a credit manager filtering by policy or business unit, I want top-N to respect those filters (and include-no-policy rules), so that concentration matches the book I already selected.
15. As a credit manager, I want the whole-book metric renamed to Credit Protection Level, so that Portfolio Health and Credit Dashboard use the same term.
16. As a Hebrew-locale user, I want all new and renamed labels in Hebrew in the same release, so that the Health tab is fully localized.
17. As a credit manager, I do not need customer lines on the Health charts for this release, so that the page stays readable while we ship the KPI card.
18. As a developer, I want 5 / 10 / 20 cohort metrics in one portfolio-health response, so that the UI can switch N without extra round-trips.
19. As a QA engineer, I want a clear API contract for the three cohort payloads, so that gauge and shares can be verified without relying on UI-only state.
20. As a product owner, I want max N capped at 20, so that the concentration story stays meaningful and does not drift toward “almost the whole book.”

## Implementation Decisions

### Primary test seam

- **Highest seam:** `GET /api/credit-insurance/portfolio-health` (portfolio health section payload) — extend the Health section with precomputed top-N cohort metrics for N ∈ {5, 10, 20}.
- **Rationale:** Ranking, aggregation, CPL, and share math belong in one place already owned by portfolio health. The UI only selects which of the three cohort objects to display and formats gauge/cards. Prefer verifying behavior at this API boundary (or a pure helper it calls) over chart/UI unit tests.
- **UI seam (secondary):** Health tab card after Longest over-limit streak + local slider state; no automated UI tests unless explicitly requested later.

### Ranking and aggregation

- Rank customers by **mean daily `total_receivables`** over the selected range (same idea as Utilization top customers), with existing portfolio-health filters: account, date range, policy, business-unit customer scope, include-no-policy / pending-review rules already used by CPT Health queries.
- Fetch/rank once for the **top 20**, then build cohort rollups for **5, 10, and 20** from that ordered list.
- For each cohort: sum the members’ mean period **total receivables**, **compliant exposure**, and **at-risk exposure**.
- **Credit Protection Level** = `(cohortCompliant ÷ cohortReceivable) × 100` using the same clamp/zero rules as the existing health-index helper (when receivable ≤ 0 → 100).
- **Share %** = cohort amount ÷ portfolio mean total for the same metric (receivable / compliant / at-risk) under the same filters; define safe behavior when portfolio denominator is 0 (show 0% or em dash consistently with nearby KPIs).
- If fewer than N customers exist: cohort uses **all available**; do not empty the card.

### API / payload shape (decision-level)

- Add a Health-section field such as `topCustomerCreditProtection` (name finalizable in implementation) containing:
  - `defaultN: 10`
  - `options: [5, 10, 20]`
  - `cohorts: { 5: CohortMetrics, 10: CohortMetrics, 20: CohortMetrics }`
- Each `CohortMetrics` includes at least: `nRequested`, `nActual`, `creditProtectionLevel`, `totalReceivables`, `totalReceivablesSharePct`, `compliantExposure`, `compliantExposureSharePct`, `atRiskExposure`, `atRiskExposureSharePct`.
- Optional customer id/name list for tooltips may be included if cheap; not required for v1 UI.

### UI

- New Island-style card **immediately after** Longest over-limit streak on the Health tab.
- Layout: **gauge** for cohort Credit Protection Level + **three** share/number cards (reuse existing Health/Dashboard visual patterns where possible — e.g. existing gauge component or CoverageHalo-adjacent patterns — without inventing new global styles).
- Slider: discrete steps **5 / 10 / 20**, default **10**, same structural pattern as the Below-threshold range control (label + range input + local React state).
- Slider only switches which precomputed cohort is shown.

### Rename (whole book)

- Replace user-facing **Average portfolio health** / **Avg. Health** copy on Portfolio Health with **Credit Protection Level** (and Hebrew equivalents aligned with Credit Dashboard wording where appropriate).
- Formula and API field names for the whole-book average may stay; this is primarily i18n + any visible labels in the halo/KPI.

### i18n

- All new and changed user-facing strings ship in **English and Hebrew** in the same change (`dashboard.json` / `credit_portfolio_health` keys). No English-only `defaultValue` gaps.

### Repos

- Primary design/planning repo: **backend**. Implementation will touch **backend** (portfolio health service + types) and **frontend** (Health section UI + locales). Same branch name in frontend when first touched: `feat/portfolio-health-top-n-cpl-CU-869f5hykt`.

## Testing Decisions

- Prefer tests of **external behavior** at the portfolio-health API / domain helper: given known CPT means for customers A>B>C…, assert ranking, cohort aggregates for 5/10/20, CPL, and share %.
- Cover edge cases: fewer than N customers; zero portfolio denominator; zero cohort receivable (CPL = 100).
- Do **not** add or expand automated tests unless the user explicitly asks during implementation.
- Manual How to test: Portfolio Health → Health tab → confirm rename; confirm new card after streak; move slider 5/10/20 and see gauge/shares update without reload; spot-check Hebrew.

## Out of Scope

- Adding customer (or top-N aggregate) **lines** to daily health or monthly exposure charts.
- Slider values other than 5 / 10 / 20 (e.g. 50).
- Changing Credit Dashboard as-of gauge behavior (beyond shared naming consistency on Portfolio Health).
- Changing Utilization top-10 ranking UI (reuse ranking idea only).
- New global theme/styles beyond existing Health card/slider patterns.
- Automated test suite expansion unless explicitly requested.

## Further Notes

- ClickUp task: https://app.clickup.com/t/869f5hykt
- Decision log locked in `/start-work` grill (2026-09-23): placement after streak; 5/10/20 slider default 10; gauge + 3 shares; mean AR ranking; aggregate-then-CPL; precompute all N; fewer-than-N uses all; no graphs; rename whole-book label to Credit Protection Level.
- Screenshots on the ClickUp task illustrate gauge + three metric cards; follow existing Portfolio Health card density rather than inventing a new design system.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/portfolio-health-top-n-cpl/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/portfolio-health-top-n-cpl/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | API: top-N Credit Protection cohorts on portfolio-health | `issues/01-api-top-n-cohorts.md` | — | 10–14, 18–20 |
| 2 | UI: top-N card, slider, and CPL rename | `issues/02-ui-top-n-card-and-rename.md` | 01 | 1–9, 15–17 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
