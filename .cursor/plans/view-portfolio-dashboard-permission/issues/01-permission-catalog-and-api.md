# 01 — Permission catalog, migration, and API gates

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
**PRD:** `.cursor/plans/view-portfolio-dashboard-permission.prd.md`

## Deliverable

Add `view_portfolio_dashboard` to the backend permission catalog (dashboards category) with the same credit-insurance product filtering as `view_credit_dashboard` (including credit-only account availability). Ship an idempotent SQL file under `prisma/migrations/` that grants the key only to `System_Administrator` (master + clone pattern; no top-level `BEGIN;` / `COMMIT;`). Extend credit-insurance access authorization so:

- `portfolio-health` requires `view_portfolio_dashboard`
- Credit Dashboard leaves keep requiring `view_credit_dashboard`
- Shared as-of backfill leaves accept **either** permission

Update seed/clone allowlists if they enumerate credit dashboard permissions.

## How to test

1. Apply the migration SQL on a local DB (or rely on CI migration runner on the branch).
2. Confirm `System_Administrator` has `view_portfolio_dashboard`; CFO (or similar) with only `view_credit_dashboard` does not.
3. Call `/api/credit-insurance/portfolio-health` with only credit permission → 403; with portfolio permission → succeeds (account has credit insurance).
4. Call a Credit Dashboard leaf (e.g. summary) with only portfolio permission → 403; with credit permission → succeeds.
5. Call as-of backfill status with either permission alone → succeeds.
6. On Roles API/catalog for a credit-insurance account, both keys appear; on collection-only, both credit keys are hidden.
