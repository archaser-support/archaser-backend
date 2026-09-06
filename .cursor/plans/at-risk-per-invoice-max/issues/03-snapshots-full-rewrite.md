# 03 — Snapshot writers + full historical rewrite

**Status:** done
**Priority:** normal
**Blocked by:** [01-shared-formula-customer-kpis](01-shared-formula-customer-kpis.md), [05-live-capacity-gap-waterfall](05-live-capacity-gap-waterfall.md)
**User stories:** 10, 11, 12, 19
**PRD:** `.cursor/plans/at-risk-per-invoice-max.prd.md`

## What to build

Update daily snapshot writers (customer policy trend and credit dashboard snapshots) so new days store at-risk from the shared per-invoice max sum, with compliant and health derived accordingly.

Provide a **one-time full rewrite** of historical snapshot rows: for each stored day D, recompute at-risk, compliant exposure, and health using **as-of open invoices for day D** (not today’s open set). Reuse existing as-of open-AR / rewrite pipeline concepts where they already exist.

**Follow-up after slice 05 (done):** as-of rewrite applies the **live waterfall as of day D** via `overlayAsOfLiveCapacityGapWaterfallOnLines` (not sticky open-day stamps). CPT no longer calls `ensureCustomerCapacityGapStored` during snapshot sync (that mutated live invoice gaps). Re-run `scripts/datafixes/rewrite-at-risk-snapshots-as-of.ts` in the target environment after deploy.

## Acceptance criteria

- [x] New snapshot writes use the new at-risk formula
- [x] One-time rewrite updates all historical days in scope for at-risk, compliant, and health
- [x] Day D rewrite uses as-of open invoices for D
- [x] After rewrite, a sample historical day is coherent: compliant ≈ total AR − at-risk; health matches that ratio
- [x] Day D capacity gaps use live waterfall as of D (post-05 follow-up)

## How to test

1. After writers ship, trigger or wait for a snapshot day and confirm stored at-risk matches live customer KPI for that as-of.
2. Run the one-time rewrite against a non-prod account (or agreed environment): `scripts/datafixes/rewrite-at-risk-snapshots-as-of.ts`.
3. Pick an old snapshot day for a known customer; verify at-risk/compliant/health were updated and reconcile to as-of open invoices for that day using `max(gap, breach)` with day-D waterfall gaps.
4. Confirm trend charts no longer show a permanent step change solely from mixed old/new formulas after rewrite.
