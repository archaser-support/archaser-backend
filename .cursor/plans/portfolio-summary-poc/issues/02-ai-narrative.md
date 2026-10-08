# 02 — AI analysis and Hebrew narrative

**Status:** done
**Priority:** normal
**Blocked by:** [01-data-bundle-skeleton-pdf](01-data-bundle-skeleton-pdf.md)
**User stories:** 1–15, 17–19, 21
**PRD:** `.cursor/plans/portfolio-summary-poc.prd.md`

## What to build

Claude (the agent) reads the data bundle and writes the full Hebrew narrative, and the render step places it in the PDF:

- **Executive summary:** three to five headline findings for the period.
- **Policy terms context:** max cover, DCL/SDL cover, fee rate, payment term, MEP, reporting days, and claims and remaining excess where relevant.
- **Costs:** total policy cost including top-ups, monthly trend, effective cost per compliant unit, registration and annual credit assessment fees.
- **Utilization and top-ups:** average and top-10 utilization, over-coverage, coverage peak, idle named customers, top-up count, affected customers and draw, and whether raising base limits would beat buying top-ups.
- **Health:** Credit Protection Level, lowest health, share of days below the threshold, longest over-limit streak, and the monthly compliant versus at-risk AR trend.
- **No coverage:** at-risk exposure (customer share, count, amount), leading reasons, and policy violations with their leading cause.
- **Recommendations:** a short prioritized action list.

Every quoted number must trace to a bundle field. If data coverage is incomplete (days with data below days in range), the narrative must say so.

## Acceptance criteria

- [x] All sections above are present in Hebrew
- [ ] Every number in the narrative matches a bundle field and the dashboard
- [x] Each insight states the number behind it and a concrete implication for the customer
- [x] Incomplete snapshot coverage is disclosed when present
- [x] The narrative source is kept in the gitignored local workspace, not committed

## How to test

1. Open the generated PDF next to Portfolio Health for account 10149 (Apr 1 – Sep 30, 2026, default filters).
2. For each insight, find the KPI or chart value it cites on the dashboard. Expect an exact match.
3. Read the recommendations and check that each one follows from a cited finding.
