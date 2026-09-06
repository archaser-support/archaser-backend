# At-risk exposure — per-invoice max(gap, terms breach)

Recalculate at-risk as `Σ max(capacity_gap_i, terms_breach_i)` across live customer/portfolio/report paths, rewrite historical snapshot health-family fields once using as-of open invoices, and update EN/HE tooltips.

**PRD:** `.cursor/plans/at-risk-per-invoice-max.prd.md`  
**ClickUp:** https://app.clickup.com/t/869exeaca  

Vertical slices live under `issues/`.
