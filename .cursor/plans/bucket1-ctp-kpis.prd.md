---
name: bucket1-ctp-kpis
overview: Ship 13 CSV-derivable CTP period KPIs across Customer, Credit, and Portfolio Health surfaces, with purpose tooltips on every credit KPI card and exportable drill-down reports where specified.
source: grill-me session + Bucket 1 KPI build prompts (ctp-last-180d.csv acceptance checks)
clickup_task_url: https://app.clickup.com/t/869f1mzvc
isProject: false
---

# Bucket 1 — CTP-derivable credit KPIs

## Problem Statement

Credit analysts see point-in-time cards (capacity gap, health index, terms breach, usage %) but cannot easily answer persistence, magnitude-over-time, momentum, data-quality, concentration, or “is this health improvement real?” questions from daily Customer×Policy Trend (CTP) history. Existing Portfolio Health covers health/utilization/cost aggregates, but not the thirteen Bucket 1 signals (chronic over-limit, overshoot magnitude, limit-capped AR, gap-days, health slope, AR volatility, stale snapshots, negative daily cost, policy concentration, limit-breach forecast, breach dilution vs resolution, breach clean-streak, exposure reconciliation). KPI card tooltips also do not consistently explain **why** each metric exists, so analysts misread vanity-looking numbers.

## Solution

Add thirteen CTP-derived KPIs with the surfaces and behaviors defined in the Bucket 1 prompts, reusing Portfolio Health’s **days available** convention (missing snapshot days excluded from denominators; gaps are not “clean” days). Provide shared streak/run and trailing-window trend utilities so persistence and slope KPIs stay consistent. Extend Credit dashboard Limit Warnings with **projected** utilization crossings only. Add exportable drill-down reports wherever a KPI prompt requires drill-through. Put a short **purpose** explanation on every KPI card tooltip on Customer credit, Credit dashboard, and Portfolio Health (existing + new). Thresholds ship as code/config defaults (no new settings UI). Reconciliation (#13) is a UI footnote + report only (no new nightly job).

## User Stories

1. As a credit analyst, I want to see how many available days a customer was over limit and their longest streak, so that I prioritize chronic over-limit accounts over one-day spikes.
2. As a credit analyst, I want Portfolio Health to show portfolio average % of days over limit and the longest streak with drill-through, so that I find the worst persistent offenders quickly.
3. As a credit analyst, I want average/max utilization overshoot above 100%, so that I know how large a limit resize is needed—not just that usage is over 100%.
4. As a credit analyst, I want a ranked Portfolio Health utilization list of overshoot by customer, so that I work the structural resize queue first.
5. As a credit analyst, I want a limit-capped insight when compliant exposure is flat while total AR grows, so that I see cover is constrained by the limit rather than improving behavior.
6. As a credit analyst, I want a dual series of total AR vs compliant exposure when limit-capped, so that the divergence is obvious.
7. As a credit analyst, I want average daily capacity gap and dollar-days of gap, so that I size uncovered exposure over the period—not only today’s gap.
8. As a credit analyst, I want an exportable capacity-gap-days report per customer, so that I can share the queue with underwriters.
9. As a credit analyst, I want a health-index momentum badge (improving / flat / deteriorating) with slope on hover, so that I act on direction—not only level.
10. As a credit analyst, I want peak vs current health framing when the path is non-monotonic, so that I am not misled by start-vs-end comparisons.
11. As a credit analyst, I want day-over-day AR volatility with extreme single-day flags, so that I investigate jumps separately from trend.
12. As a credit analyst, I want stale/carried-forward snapshot days marked on charts and excluded from slope/volatility by default, so that quiet weekends do not look like stability.
13. As a credit analyst, I want a Portfolio Health footnote of carried-forward snapshot days, so that I trust the period math.
14. As a credit analyst, I want negative daily cost rows surfaced with count and sum, so that credits/refunds do not hide inside period cost totals.
15. As a credit analyst, I want an exportable list of negative cost rows, so that finance can review outliers above a minimum magnitude.
16. As a credit analyst, I want policy concentration (top-1 / top-3 AR share) per policy, so that I see single-name risk on a shared policy.
17. As a credit analyst, I want a customer context line of “X% of policy P’s open AR,” so that I understand that customer’s weight on the policy.
18. As a credit analyst, I want a projected date to cross 150%/200% utilization when the trend is toward the threshold, so that I act before the breach.
19. As a credit analyst, I want forecast entries in Limit Warnings clearly labeled as projected, so that I never confuse them with actual near-limit warnings.
20. As a credit analyst, I want rising health classified as resolved vs diluted by AR growth, so that I do not celebrate misleading recovery.
21. As a credit analyst, I want a Portfolio Health list of diluted customers, so that I work the highest-priority misleading-improvement queue.
22. As a credit analyst, I want breach-free / in-breach streak badges and episode history, so that I judge trust rebuilding after terms breaches.
23. As a credit analyst, I want exposure reconciliation failures footnoted with drill-down, so that I know when at-risk + compliant do not match total AR.
24. As a credit analyst, I want every KPI card tooltip to explain the purpose of that KPI, so that I know what decision the metric supports.
25. As an implementer, I want shared streak and trend utilities, so that over-limit, breach, and gap KPIs do not diverge.
26. As an account admin, I want missing CTP days excluded from denominators the same way as existing Portfolio Health, so that sparse history does not invent clean days.
27. As a Hebrew-speaking analyst, I want all new labels, tooltips, banners, and report titles in Hebrew as well as English, so that the UI is fully usable in either locale.
28. As a reviewer, I want How-to-test steps tied to the Bucket 1 acceptance examples (C1–C6 on the anonymized 180d export), so that formula regressions are catchable manually against live CTP.

## Implementation Decisions

- **Scope:** All thirteen Bucket 1 KPIs in this ClickUp task; surfaces follow each prompt (Customer dashboard, Portfolio Health tabs, Credit Limit Warnings for forecast only).
- **Date windows:** Portfolio Health uses the page date range; Customer dashboard uses the existing trailing-window pattern for period CTP KPIs; Credit stays live/point-in-time except forecast (trailing 30 days default).
- **Days available:** Reuse Portfolio Health convention—only days with CTP aggregates count; missing calendar days are excluded from denominators and break streaks (not treated as clean).
- **Shared utilities (prefer domain package):** (1) streak/run detection for over-limit days, breach days, and gap accumulation; (2) trailing-window linear trend/slope with configurable suppress thresholds; (3) stale/carried-forward identical AR detection with shared flag consumed by slope/volatility. Extract/generalize existing Portfolio Health streak helpers rather than forking three copies.
- **Stale days:** Detected runs of identical non-zero AR across consecutive snapshot days; exclude from slope (#5) and volatility (#6) by default; mute/mark on AR trend charts; footnote count on Portfolio Health.
- **Thresholds:** Ship prompt defaults in code/config only (limit-capped CVs/growth, slope cutoffs, R² floor, ±10% AR swing, negative-cost minimum magnitude, forecast targets 150%/200%). No new settings screens. Existing Portfolio Health health-threshold slider remains as-is for current health KPIs.
- **Placement:** #1/#4/#5/#11/#12 on Portfolio Health Tab 1 (and customer cards/banners as specified); #2/#9 on Utilization; #8 on Costs; #7/#13 as footnotes (+ chart markers for #7); #10 extends Credit Limit Warnings as projected.
- **Limit-capped (#3):** Suppress when fewer than ~14 available days; show banner + dual normalized series only when flag fires.
- **Forecast (#10):** Show only when trending toward threshold; suppress when R² below floor; label projected vs actual near-limit.
- **Dilution (#11):** Never classify customers with no breach history; diluted queue is filterable on Portfolio Health Tab 1.
- **Breach streaks (#12):** “No breach on record” when never breached in available history—do not invent a huge clean streak from window start.
- **Reconciliation (#13):** UI footnote + exportable row report only; do not filter/hide underlying dashboard data; no new nightly job in this task.
- **Reports:** Full exportable drill-downs for every KPI that mentions drill-through (reuse credit-dashboard report route/patterns; add report types as needed). Single-customer policies excluded from concentration *alerting* but may still show 100% context.
- **Purpose tooltips:** Every KPI card on Customer credit, Credit dashboard, and Portfolio Health (existing + new) gets a short purpose explanation (EN+HE). Prefer extending existing `tooltips.*` / metric description keys.
- **API shape:** Extend `customer-dashboard-kpis`, `portfolio-health`, and credit summary/`limit_warning` report contracts with additive fields; avoid breaking existing clients.
- **Schema:** Prefer deriving from existing `CustomerPolicyTrend` columns; no new Prisma models required unless a report type needs persisted membership (prefer on-the-fly from CPT).
- **i18n:** All new/changed user-facing strings ship EN+HE together.
- **Primary repo:** Backend for domain/API first; frontend branch created when UI work starts (same branch name).
- **Acceptance numbers:** `ctp-last-180d.csv` examples are How-to-test references; re-verify against live CTP before treating as golden production fixtures.

## Testing Decisions

- Prefer testing **external behavior** of pure domain helpers (streak, overshoot, slope classification, stale runs, dilution classification, reconciliation delta) with known series inputs shaped like CTP days—not UI internals.
- Highest seams: shared streak/trend/stale utilities; then portfolio-health / customer-dashboard-kpis / limit-warning API responses; then report row sets.
- Manual How-to-test on each slice remains required; automated unit/integration tests are **out of scope unless the user explicitly asks**.
- Prior art: Portfolio Health period metrics and streak windows in the portfolio-health service; customer dashboard KPI golden snapshot helpers; existing credit dashboard report types (`limit_warning`, `utilization_bin`, capacity gap).
- Spot-check acceptance examples from the anonymized export (C1 over-limit 181/181; C1 overshoot ~+71 pts; C2 diluted; C6 clean streak; C5 reconciliation) against live account data using the same formulas—not by copying fake keys into production.

## Out of Scope

- Account-level UI for tuning every threshold.
- Nightly/ops data-quality cron for reconciliation (#13).
- Claims outcomes, deductible-aware net cost, cost-vs-health scatter.
- Renaming or rehashing existing point-in-time KPIs beyond purpose tooltips.
- Automated test suites unless explicitly requested.
- Shipping planning-only work as a ready-for-review product PR (planning commit is separate).

## Further Notes

### KPI inventory (Bucket 1)

1. Chronic over-limit / capacity-breach persistence  
2. Utilization overshoot magnitude  
3. Compliant-exposure ceiling detection (limit-capped)  
4. Capacity-gap-days (gap-weighted exposure)  
5. Health index trend slope  
6. Day-over-day AR volatility  
7. Reporting cadence / stale-snapshot flag  
8. Anomalous daily-cost sign flag  
9. Portfolio concentration on shared policy  
10. Limit-breach forecast  
11. Breach persistence vs dilution  
12. Breach resolution / clean-streak tracking  
13. AR / exposure reconciliation check  

### Codebase scan

**Required**

- Portfolio Health period service and date-range helpers (days available, streak windows, section builders).  
- Credit-insurance leaves/controller/service routing for `portfolio-health`, `customer-dashboard-kpis`, report types.  
- `@archaser/credit-insurance-domain` customer dashboard KPIs, credit dashboard summary/limit warnings/reports, CPT read/write services and `CustomerPolicyTrend` schema fields.  
- Frontend Portfolio Health screen/sections; Customer `CustomerDashboardCards` + KPI query; shared `CreditMetricCard`; Credit dashboard Limit Warnings + report pipeline.  
- EN/HE `dashboard.json` / `customers.json` credit namespaces and tooltips.  
- New shared streak/trend/stale pure helpers (none for slope/volatility today).  

**Optional / out of scope unless a slice needs them**

- Pure chart chrome / design tokens; as-of backfill jobs; policy admin settings; unrelated cost-percent rewrite scripts; `.scratch` CSV exports (reference only).  

**No change needed**

- Navigation routes for credit dashboard / portfolio health / customer page (already exist).  
- Operation/invoice dashboards.  
- Prisma models outside CPT / credit report membership needs.  

### Grill decision log

- All 13 KPIs in this task.  
- Windows match each surface.  
- Purpose tooltips on every KPI card on the three surfaces.  
- Full exportable reports where prompts mention drill-down.  
- Defaults-only thresholds.  
- #13 UI only.  
- Stale days excluded from #5/#6 by default.  

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/bucket1-ctp-kpis/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/bucket1-ctp-kpis/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Shared CTP streak, trend, and stale utilities | `issues/01-shared-ctp-series-utilities.md` | — | 25, 26 |
| 2 | Purpose tooltips on all credit KPI cards | `issues/02-kpi-purpose-tooltips.md` | — | 24, 27 |
| 3 | Chronic over-limit + capacity-gap-days | `issues/03-over-limit-and-gap-days.md` | 01 | 1–2, 7–8, 28 |
| 4 | Stale snapshots + health slope + AR volatility | `issues/04-stale-slope-volatility.md` | 01 | 9–13, 28 |
| 5 | Utilization overshoot + limit-capped detection | `issues/05-overshoot-and-limit-capped.md` | 01 | 3–6, 28 |
| 6 | Negative daily cost + exposure reconciliation | `issues/06-cost-sign-and-reconciliation.md` | — | 14–15, 23, 28 |
| 7 | Policy concentration + limit-breach forecast | `issues/07-concentration-and-forecast.md` | 01 | 16–19, 28 |
| 8 | Breach dilution vs resolution + clean streaks | `issues/08-breach-dilution-and-streaks.md` | 01 | 20–22, 28 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
