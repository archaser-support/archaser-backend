# Prevent stale overdue rollups after billing sync

Keep customer overdue rollups aligned with Paid invoices after billing sync: reliable rollup loading in the worker, honest non-SUCCESS when balances fail, header safety when live Due/Overdue is empty, plus reconciliation and one-time cohort repair.

**PRD:** `.cursor/plans/prevent-stale-overdue-rollups.prd.md`

**Related:** ClickUp [Prevent stale overdue rollups](https://app.clickup.com/t/869f3epee) · staging sync `c61773a3` / customer 21137

Vertical slices live under `issues/`.
