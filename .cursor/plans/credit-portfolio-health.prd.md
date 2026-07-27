---
name: credit-portfolio-health
overview: Live credit portfolio health analytics page with period-based Health, No Coverage, Utilization, and Costs KPIs, dual Health series, CPT-on-read aggregation, and a Tailwind + Recharts visual redesign (pill tabs, Coverage Halo).
source: grill-me sessions (KPI pack + UI redesign 2026-07-20)
clickup_task_url: https://app.clickup.com/t/869e2mdbc
isProject: false
---

# Credit Portfolio Health Analytics

## Problem Statement

Credit analysts need a **period-based portfolio analytics** view for the credit-insurance product: how healthy the portfolio was over a date range, how much time it spent in poor health, how much of the book is uncovered and why, how efficiently limits and top-ups are used, and what coverage costs in practice.

Today’s **credit dashboard** is an operational surface (live cards, alerts, short trends). It does not offer a dedicated analytics page with selectable from/to periods, dual Health metrics that include vs exclude customers declined by the insurer, smoothed period averages for coverage and cost effectiveness, or a coherent four-section KPI pack (Health / No Coverage / Utilization / Costs & Effectiveness).

Without that page, analysts reconstruct answers from live KPIs, customer-policy trend charts, and ad-hoc exports — and cannot consistently answer “how long were we below 85% health?” or “what did each shekel of compliant coverage cost this period?”

## Solution

1. **New route** — Ship `/credit-portfolio-health` as a **separate page** from the live credit dashboard. Keep the existing dashboard unchanged for day-to-day operations.

2. **Nav and access** — Place navigation next to the credit dashboard. Reuse permission **`view_credit_dashboard`** (no new permission matrix). Same credit-analyst audience.

3. **Period and filters** — User-selectable **from/to** date range (default last **30 days**). Same three scopes as the credit dashboard: **policy**, **business unit**, and **include/exclude no-policy cohort**.

4. **Four pill tabs in one MVP** — Portfolio Health, No Coverage, Utilization, Costs & Effectiveness. Optional `?tab=` deep link. **Built-in deductible %** has no schema field yet — show an **N/A / “—”** card with tooltip until a policy-level field exists (do not invent a number).

5. **Visual redesign (live data)** — Page-scoped **Tailwind + Recharts** island with Coverage Halo (Health A), dual A/B cards, design tokens, motion (respecting `prefers-reduced-motion`), and Space Grotesk for stats. **MUI** sticky filters (`PageHeader` + BU/policy/no-policy/date) remain. No mock-data demo route; no “Live portfolio feed” or “Selling point” chrome.

6. **History on read** — Aggregate **CustomerPolicyTrend** daily rows for dual Health and most time-series math. Supplement **true no-policy / uncovered** point-in-time and gap cases with the same summary helpers the credit dashboard uses; historical no-policy only where portfolio daily snapshots already store it. No new portfolio snapshot columns for dual Health in v1. Caching deferred.

7. **Honest sparse history** — Average only over days that have data; show an **“N of M days available”** footnote so analysts know when the range is incomplete (not an “illustrative figures” disclaimer).

8. **As-of snapshot prerequisite** — Trustworthy period KPIs depend on **as-of daily snapshot rewrite** (payment-ledger open AR for past days; coalesced queue drained by daily crons; next-morning lag after late imports). See `.cursor/plans/as-of-daily-snapshot-rewrite.prd.md`. Do not treat CPT/dashboard history as authoritative for period analytics until that workstream’s drain/backfill is in place.

## User Stories

1. As a credit analyst, I want a dedicated portfolio health analytics page, so that I can review period KPIs without mixing them into the operational credit dashboard.

2. As a credit analyst, I want the page reachable from the app nav next to the credit dashboard, so that I can find it as part of the credit product.

3. As a credit analyst with `view_credit_dashboard`, I want access to this page without a separate permission, so that role setup stays simple.

4. As a credit analyst, I want to pick a from/to date range (default last 30 days), so that Health and cost KPIs reflect the period I care about.

5. As a credit analyst, I want to filter by insurance policy (all or one), so that analytics match a selected policy scope.

6. As a credit analyst, I want to filter by business unit, so that BU-scoped portfolios are comparable to the credit dashboard.

7. As a credit analyst, I want the include/exclude no-policy cohort toggle, so that I can align analytics with the same cohort visibility as the credit dashboard.

8. As a credit analyst, I want **average portfolio health %** over the range, so that I see typical health—not only today’s gauge.

9. As a credit analyst, I want the **lowest health %** in the range and **how long** the portfolio stayed at that low (longest consecutive streak with **start/end dates**, most-recent tie-break), so that I can judge severity, persistence, and when the trough occurred.

10. As a credit analyst, I want the **percentage of days** the portfolio was **below 85%** health, so that I can quantify time in an unhealthy band.

11. As a credit analyst, I want a **monthly trend chart** of total open AR, covered (compliant), and uncovered (at-risk) amounts, so that I can see composition over months in the selected range.

12. As a credit analyst, I want **every Health metric in two series**—including vs excluding customers with exclusion reason **Insurer declined**—so that insurer non-approval does not obscure the rest of the portfolio.

13. As a credit analyst, I want Health series **A** to use the current filter scope and series **B** to be A minus Insurer declined only, so that other exclusions remain in both series unless the no-policy toggle already removed them.

14. As a credit analyst, I want **No Coverage** to mean all **uncovered exposure** (no linked policy or any exclusion reason), so that self-borne risk is not understated by the narrower No Policy Exposure card cohort.

15. As a credit analyst, I want the **percentage of customers** with no coverage and the **monetary amount**, so that I can size the uncovered book.

16. As a credit analyst, I want a **breakdown of reasons** for lack of coverage (allowlisted exclusion reasons plus no linked policy), so that I can prioritize remediation.

17. As a credit analyst, I want **average % of policy violations** based on **terms breach** for **approved** customers only, so that uncovered customers do not inflate violation rates the way portfolio Terms Breach already excludes them.

18. As a credit analyst, I want the **main terms-breach reason** and its **share of total breach amount** over the range, so that I know which breach type dominates.

19. As a credit analyst, I want **average effective policy utilization %** (size-weighted usage vs effective approved limit) for approved customers, so that utilization reflects policy + top-up capacity.

20. As a credit analyst, I want the **percentage of days** portfolio effective utilization was **above 100%**, so that I can see how often the book ran over effective cover.

21. As a credit analyst, I want the **highest coverage/utilization %** and **how long** it stayed there (longest streak at that exact peak, with **start/end dates** and most-recent tie-break), so that peak over-utilization is measurable in calendar context.

21b. As a credit analyst, I want a **utilization distribution** as of the range end date for approved customers with a positive effective limit, binned exclusively into `0–10%`, `10–20%`, `20–50%`, `50–75%`, and `≥75%`, so that I can see how usage is spread across the book.

22. As a credit analyst, I want **self-underwritten** defined as uncovered customers (no linked policy or any exclusion), so that “self-borne risk” matches product language—not DCL limit type.

23. As a credit analyst, I want **approved** defined as linked policy and not excluded (clean DCL + clean Named), so that insured customers are the complement of uncovered.

24. As a credit analyst, I want **customer % and monetary share** for self-underwritten vs approved, so that I can see mix of self-borne vs insured risk.

25. As a credit analyst, I do **not** want a fake limit-utilization % for self-underwritten customers, so that missing limits are not turned into misleading percentages.

26. As a credit analyst, I want average **top-up utilization %** when top-ups were in use, so that I can see how much temporary cover was consumed.

27. As a credit analyst, I want average daily **top-up count** and average daily **customers with an active top-up**, so that I can size top-up usage over the period.

28. As a credit analyst, I want **coverage % for the 10 largest customers** as of the **range end date**, so that concentration risk is actionable against a concrete ranking.

29. As a credit analyst, I want **policy efficiency** as health ÷ utilization for **both** Health A and Health B (each shown with a **×** suffix), so that efficiency stays consistent with dual Health.

30. As a credit analyst, I want **policy cost for the period including top-ups** (sum of daily total cost on approved rows) and a **daily cost sparkline**, so that spend matches the insured book and I can see cost shape over the period.

31. As a credit analyst, I want **effective cost** = period cost ÷ average daily compliant exposure, formatted in **account currency** (subunit wording such as agorot only when applicable, e.g. ILS), so that I know how much each unit of compliant coverage costs.

32. As a credit analyst, I want a **deductible** card that shows **N/A / “—”** with a “Not configured yet” tooltip until a policy-level field exists, so that the page reserves the slot without inventing a number.

32b. As a credit analyst, I want a **Coverage Halo** on the Portfolio Health tab driven by **Health A** average, with side-by-side A vs B health metrics, so that the hero visual matches the primary filter scope while dual series remain visible.

33. As a credit analyst, I want percents and amounts to be **averages of daily values** over available days in the range, so that the period view is smoothed.

34. As a credit analyst, I want count KPIs shown as **average daily counts with one decimal**, so that period-smoothed counts remain readable.

35. As a credit analyst, I want a footnote **“N of M days available”** when snapshot history is sparse, so that I do not misread averages over incomplete data.

36. As a Hebrew-speaking user, I want page title, section labels, KPI names, and footnotes translated, so that the page matches the rest of the credit product.

37. As an English-speaking user, I want the same strings in English, so that locales stay parallel.

38. As a developer, I want a **single portfolio-health aggregator service** as the test seam, so that KPI math is unit-tested without UI or DB coupling.

39. As a developer, I want to reuse existing exclusion, health-index, and credit-dashboard auth helpers, so that analytics do not drift from operational definitions.

40. As a developer, I want CustomerPolicyTrend as the primary historical source, so that dual Health (Insurer declined) can be recomputed without new portfolio snapshot columns.

41. As a developer, I want no-policy exposure supplemented from dashboard summary helpers and portfolio snapshots where present, so that true uninsured customers are not silently dropped from CPT-only aggregates.

42. As a QA engineer, I want unit tests for dual Health, trough/peak streaks, utilization weighting, uncovered vs approved shares, violation math, cost/effective cost, top-up averages, and missing-day footnotes, so that regressions are caught at the aggregator seam.

43. As a product owner, I want the live credit dashboard left intact, so that operational workflows are not disrupted by this analytics launch.

44. As a credit analyst, I want monthly chart series labeled as total / covered / uncovered with compliant and at-risk meanings, so that the chart matches Health index math.

45. As a credit analyst viewing efficiency, I want utilization in the denominator to be the same effective-usage portfolio series used elsewhere on the page, so that ratios are coherent.

## Implementation Decisions

### Surface and access

- App route **`/credit-portfolio-health`**, separate from `/credit-dashboard`.
- Sidebar entry adjacent to the credit dashboard; gate with existing **`view_credit_dashboard`**.
- Single MVP ships all four **tabs**; deductible **schema** deferred; deductible **UI** = N/A card.

### Filters and period

- Query params (or equivalent) for `from`, `to`, policy id, business unit id, include/exclude no-policy cohort, and optional **`tab`**—aligned with credit-dashboard filter UX.
- Default range: last 30 days ending today (account/timezone conventions consistent with other credit daily snapshots / UTC calendar days as used by CPT).
- Sticky product chrome: title + MUI filters; **no** “Live portfolio feed” pill.

### Aggregator module (primary seam)

- **credit portfolio health service** accepts account + range + filter scope and returns one response payload (Health, No Coverage, Utilization, Costs, chart series, streak windows, distribution bins, daily cost points, `daysAvailable` / `daysInRange`, account currency for costs).
- Thin authenticated GET API that authorizes like other credit-dashboard APIs and calls that service.
- UI: MUI filters + **Tailwind/Recharts island** (Halo, tabs, cards, tooltips); deps `recharts` + `lucide-react`; Space Grotesk scoped to this route.

### Cohorts

- **Uncovered / self-underwritten**: no linked policy OR any non-empty exclusion reason (same family as uncovered-exposure helpers).
- **Approved**: linked policy AND not excluded (clean DCL + clean Named).
- **No Coverage KPIs**: uncovered cohort (not the narrower No Policy Exposure **card** cohort).
- **Health A**: current filter scope; **Health B**: A minus rows/customers with exclusion reason **Insurer declined** only.
- **Violations**: terms breach on **approved** only.

### Health formulas

- Daily portfolio health = compliant exposure ÷ total receivables × 100 (same health-index helper as the credit dashboard).
- Average health = mean of daily portfolio health over **available** days.
- Lowest = minimum daily health; duration = longest consecutive run at that exact minimum; payload includes **streak start/end**; if multiple equal-length troughs, prefer the **most recent**.
- Coverage Halo uses **Health A** average; UI also shows A vs B side-by-side.
- % time below 85% = count of available days with health &lt; 85 ÷ available days.
- Monthly trend: total = open AR; covered = compliant exposure; uncovered = at-risk exposure; dual A/B toggle; rendered with Recharts stacked area in the island.

### Utilization formulas

- Daily portfolio utilization = sum(usage amount) ÷ sum(effective approved limit) for **approved** rows × 100; page average = mean of those daily %.
- Above 100% / peak / streak use that same daily series (peak = max; streak window + most-recent tie-break as Health).
- Self-underwritten: **no** limit-utilization %; only customer % and monetary share (daily averages). Do **not** ship a self-vs-approved limit-utilization bar.
- Top-up utilization: mean of daily size-weighted top-up usage among rows with top-up total &gt; 0.
- Top-up count = average daily sum of active top-up counts; customers = average daily count of customers with an active top-up (one decimal).
- Top-10 customers: as of **range end date**, ordered like existing top usage (largest by usage amount); show coverage/utilization for those ten.
- Efficiency: healthA ÷ utilization and healthB ÷ utilization (utilization = effective portfolio series); UI shows both with **×**.
- Distribution: as-of range end; approved + positive effective limit; exclusive bins `0–10`, `10–20`, `20–50`, `50–75`, `≥75`.

### No Coverage / violations

- Uncovered % and amount: average of daily values over available days.
- Reasons: allowlisted exclusion reasons + explicit “no linked policy”.
- Average violation %: each day terms_breach_amount ÷ approved total receivables × 100; mean of daily %; main reason by **summed breach amount** over the range; share = that reason’s amount ÷ total breach amount.

### Costs

- Period cost = sum of `total_daily_cost` over available days for **approved** rows (includes top-ups).
- Daily cost series for sparkline inside the cost card.
- Effective cost = period cost ÷ average daily compliant exposure over available days; **account currency**; subunit copy only when applicable.
- Self vs approved monetary/customer shares: uncovered vs approved (daily averages); **no** “Selling point” badge on approved footprint.
- Deductible card: **N/A / “—”** + tooltip until schema exists.

### Data sources

- Primary: **CustomerPolicyTrend** aggregated on read (exclusion reason, exposures, usage, costs, breach fields).
- Supplement no-policy / missing CPT customers via credit-dashboard summary helpers for current/live-aligned uncovered math; historical no-policy via portfolio daily snapshot fields when present.
- Business unit filter via customer join (trend rows are not BU-keyed).
- No schema change required for dual Health in v1 on the analytics side; **CPT / dashboard writers are owned by the as-of rewrite PRD** (not “read-only forever”).
- Expect **next-morning** correction after late-dated invoice/payment imports once as-of queue drain is live.
- Caching out of scope for v1.

### Missing days

- Denominator for averages and %-of-time = days with data only.
- Response includes N (available) and M (calendar days in selected range) for UI footnote.
- Do not invent zero health/utilization for missing days.

### i18n

- New strings for nav, page, tabs, KPI labels, distribution bins, tooltips, deductible N/A, and N/M footnote in **EN and HE** — **permission granted** for this slice (`locales/en|he/dashboard.json` and related nav keys).

## Testing Decisions

### Primary test seam (confirm with product/eng)

**One seam:** the portfolio-health **aggregator service** (pure/exported computation over prepared daily portfolio inputs + as-of top-10 inputs). Prefer testing that module’s external behavior: given daily aggregates and cohort flags, assert KPI outputs. Avoid UI tests and avoid asserting SQL shape.

If thin pure helpers are extracted (streak length, mean of daily %, dual-series split), they remain **inside** that service’s public surface or clearly owned by it—not a second parallel seam across the codebase.

Please confirm this single-seam approach matches expectations before `/to-issues` slicing.

### What makes a good test

- Assert observable KPI numbers and series, not internal query structure.
- Use fixture daily portfolios (compliant/total AR, exclusion reasons, usage/limits, costs, breach amounts) rather than full DB.
- Cover edge cases: empty range, single day, missing days (N &lt; M), zero receivables (health 100), zero compliant (effective cost undefined/guard), no top-ups, all Insurer declined removed for series B, equal-length streak tie-break (most recent), distribution with empty/zero-limit exclusions, bins summing ~100%.

### Modules under test

- Portfolio health aggregator (primary).
- Route accessibility / nav wiring for the new path under `view_credit_dashboard` (existing navigation/accessibility test patterns).

### Prior art

- Credit dashboard snapshot / health-index unit tests.
- Credit dashboard cohort / uncovered-exposure unit tests.
- CustomerPolicyTrend mapping and terms-breach-by-reason unit tests.
- `isAppRouteAccessible` / navigation tests for credit dashboard permission.

## Out of Scope

- Built-in deductible **schema field** and real deductible % (N/A UI is in scope; real KPI when policy-level data exists).
- Extending portfolio daily snapshots with dual Health columns.
- Writing CustomerPolicyTrend (or sibling) rows for customers with no linked policy to get full historical uncovered series.
- Implementing as-of open-AR rewrite / rewrite queue / admin backfill (**owned by** `.cursor/plans/as-of-daily-snapshot-rewrite.prd.md`).
- Response caching / materialized analytics tables.
- Merging this analytics pack into the live credit dashboard UI.
- New RBAC permission key.
- Changing live credit-dashboard KPI definitions or Terms Breach chart behavior (those remain owned by their own PRDs).
- Drill-down reports from every analytics card (optional later unless product asks).
- Separate mock-data sales-demo route; “Live portfolio feed” pill; “Selling point” badge; illustrative-figures footer.
- Self-underwritten limit-utilization % comparison bar.
- App-wide Space Grotesk / global MUI theme restyle for this feature.

## Further Notes

### Decision log (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Surface | Brand-new route, separate from credit dashboard |
| D2 | Period | From/to, default last 30 days |
| D3 | Filters | Policy + BU + no-policy cohort toggle |
| D4 | Dual Health | A = filter scope; B = A − Insurer declined |
| D5 | History | Aggregate CustomerPolicyTrend on read |
| D6 | No-policy | Supplement with dashboard helpers; historical via portfolio snapshots where present |
| D7 | No Coverage | All uncovered exposure |
| D8 / D8b | Self / approved | Uncovered vs clean insured (not DCL vs Named) |
| D9 | Self utilization | Omit limit %; shares only |
| D10 / D11 | Violations | Terms breach; approved only |
| D12 | Health avg / trough | Mean daily; min; longest streak at min (+ start/end; see UI-D17/18) |
| D13 | Utilization series | Effective usage; &gt;100% over effective limit |
| D14 | Monthly amounts | AR / compliant / at-risk |
| D15 | Deductible | Schema deferred; UI N/A card (UI-D15) |
| D16 | Cost | Sum total daily cost (approved); ÷ avg compliant; daily sparkline |
| D17 | Delivery | All four tabs in one MVP |
| D18 | Route / perm | `/credit-portfolio-health`; `view_credit_dashboard` |
| D19 / D19b | Stock KPIs | Daily averages; counts 1 decimal; top-10 as-of range end |
| D20 | Avg utilization | Size-weighted daily then mean |
| D21 | Violation % | Mean daily breach AR / approved AR; main reason by amount |
| D22 | Efficiency | A/util and B/util (UI × suffix) |
| D23 | Top-ups | Daily weighted util + avg daily counts |
| D24 | Missing days | Available days only + N/M footnote |
| D25 | As-of history | Prerequisite: as-of daily snapshot rewrite PRD; next-morning lag; do not trust period KPIs until drain/backfill lands |
| UI-D1 | Delivery | Restyle live page; real API data |
| UI-D2 | UI stack | Tailwind + Recharts island; MUI filters |
| UI-D3 | Util/Costs | Full service + UI; deductible schema deferred |
| UI-D4 | Nav | Pill tabs; optional `?tab=` |
| UI-D5 | Halo | Halo = Health A; A/B cards; chart toggle |
| UI-D6 | Self util | Keep D9 — no self limit % |
| UI-D7 | Distribution | As-of end; approved + positive effective limit |
| UI-D8 | Bins | Exclusive 0–10 / 10–20 / 20–50 / 50–75 / ≥75 |
| UI-D9 | Header | Product chrome; no live-feed pill |
| UI-D10 | Sales badge | None |
| UI-D11 | Cost sparkline | Daily cost series |
| UI-D12 | Fonts | Space Grotesk route-scoped; Inter labels |
| UI-D13 | i18n | EN + HE in this slice |
| UI-D14 | Money | Account currency; subunit when applicable |
| UI-D15 | Deductible UI | N/A / “—” + tooltip |
| UI-D16 | Efficiency UI | A and B with × |
| UI-D17 | Streak copy | API start/end + locale format |
| UI-D18 | Streak ties | Most recent equal-length streak |

### Related work

- Uncovered-exposure / No Policy Exposure card cohort work (pending-review PRD) defines card vs uncovered cohorts; this page’s No Coverage KPI uses the **broader uncovered** definition.
- CustomerPolicyTrend daily KPIs supply the grain this aggregator reads.
- **Prerequisite:** [As-of daily snapshot rewrite](.cursor/plans/as-of-daily-snapshot-rewrite.prd.md).

### Plan copy

- Implementation plan also under `.cursor/plans/credit_portfolio_health_5a1e0361.plan.md`.

## Issues (vertical slices)

Tracer-bullet breakdown for **remaining** work published as local markdown under `.scratch/credit-portfolio-health/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

Prior foundation (shell, Health, No Coverage) already shipped via ClickUp under [Coverage performance assesment](https://app.clickup.com/t/869e2mdbc).

**Overview:** `.scratch/credit-portfolio-health/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Streak windows and chart/font deps | `issues/01-streak-windows-and-deps.md` | — | 9, 21, 38, 42 |
| 2 | UI island: tabs, Halo, Health & No Coverage | `issues/02-ui-island-health-no-coverage.md` | 01 | 8–18, 32b, 35–37, 44 |
| 3 | Utilization tab (service + UI) | `issues/03-utilization-tab.md` | 02 | 19–29, 21b, 33–34, 42, 45 |
| 4 | Costs & Effectiveness tab (service + UI) | `issues/04-costs-effectiveness-tab.md` | 02 | 24, 30–32, 33–34, 36–37, 42 |

*Soft:* 03 and 04 may proceed in parallel after 02. Deductible schema still deferred (N/A UI in slice 04).

**Status:** `ready-for-agent` on all slices.
