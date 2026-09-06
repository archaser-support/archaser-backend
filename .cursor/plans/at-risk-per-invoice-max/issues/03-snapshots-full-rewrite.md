# 03 — Snapshot writers + full historical rewrite

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [01-shared-formula-customer-kpis](01-shared-formula-customer-kpis.md)
**User stories:** 10, 11, 12, 19
**PRD:** `.cursor/plans/at-risk-per-invoice-max.prd.md`

## What to build

Update daily snapshot writers (customer policy trend and credit dashboard snapshots) so new days store at-risk from the shared per-invoice max sum, with compliant and health derived accordingly.

Provide a **one-time full rewrite** of historical snapshot rows: for each stored day D, recompute at-risk, compliant exposure, and health using **as-of open invoices for day D** (not today’s open set). Reuse existing as-of open-AR / rewrite pipeline concepts where they already exist.

## Acceptance criteria

- [ ] New snapshot writes use the new at-risk formula
- [ ] One-time rewrite updates all historical days in scope for at-risk, compliant, and health
- [ ] Day D rewrite uses as-of open invoices for D
- [ ] After rewrite, a sample historical day is coherent: compliant ≈ total AR − at-risk; health matches that ratio

## How to test

1. After writers ship, trigger or wait for a snapshot day and confirm stored at-risk matches live customer KPI for that as-of.
2. Run the one-time rewrite against a non-prod account (or agreed environment).
3. Pick an old snapshot day for a known customer; verify at-risk/compliant/health were updated and reconcile to as-of open invoices for that day using `max(gap, breach)`.
4. Confirm trend charts no longer show a permanent step change solely from mixed old/new formulas after rewrite.
