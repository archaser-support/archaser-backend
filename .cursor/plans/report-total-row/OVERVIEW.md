# Report total row

Optional total row for builder reports: a "Show total row" toggle saved on the report, and a total row fixed at the bottom of the report viewer grid. Each column shows its own aggregation, computed on the server over every row that matches the current filters and search.

**PRD:** `.cursor/plans/report-total-row.prd.md`

Vertical slices live in `issues/`. This breakdown covers the **builder and report viewer** only. Export slices (export dialog checkbox, CSV / Excel, PDF, scheduled exports — user stories 16–21) are not published yet.

**Related:** [Bug: Report column header totals only count loaded rows](https://app.clickup.com/t/869ffnajv), [Bug: Grouped report money totals add different currencies together](https://app.clickup.com/t/869ffnakm) — both should reuse the totals and currency helpers built here.
