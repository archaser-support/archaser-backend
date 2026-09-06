# At-risk exposure + live capacity gap allocation

At-risk = `Σ max(live capacity_gap_i, terms_breach_i)`. Capacity Gap card = `max(0, open AR − effective limit)`. Invoice gaps are a live waterfall cache (oldest invoice date first), rewritten on AR-changing events—not sticky open stamps.

**PRD:** `.cursor/plans/at-risk-per-invoice-max.prd.md`  
**ClickUp:** https://app.clickup.com/t/869exeaca  

Vertical slices live under `issues/`.

| # | Title | Status | Waiting on |
|---|-------|--------|------------|
| 01 | Shared formula + customer live KPIs | done (re-verify after 05) | — |
| 02 | Portfolio + report live enrichment | (see issue file) | 01 |
| 03 | Snapshot writers + full historical rewrite | done | 01, 05 |
| 04 | EN/HE tooltips + unpaid column visibility | done | — |
| 05 | Live capacity-gap waterfall + card + event rewrite | done | — |
