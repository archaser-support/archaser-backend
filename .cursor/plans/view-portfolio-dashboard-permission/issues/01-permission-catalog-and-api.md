# 01 — Permission catalog, account flag, and API gates

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 19, 20, 21
**PRD:** `.cursor/plans/view-portfolio-dashboard-permission.prd.md`

## Deliverable

Add `view_portfolio_dashboard` to the backend permission catalog (dashboards category). Add `Account.hide_portfolio_health` Boolean default `false` via Prisma + idempotent SQL under `prisma/migrations/` (no top-level `BEGIN;` / `COMMIT;`). Same migration (or companion SQL on the branch) grants `view_portfolio_dashboard` only to `System_Administrator` (master + clone pattern).

Catalog rules:

- Show `view_portfolio_dashboard` only when credit insurance is on **and** `hide_portfolio_health` is false
- Credit-only accounts: keep the key available when not hidden
- Do **not** delete RolePermission rows when hide turns on

API authorization:

- `portfolio-health` requires `view_portfolio_dashboard` + credit insurance + not hidden
- Credit Dashboard leaves keep requiring `view_credit_dashboard`
- Shared as-of backfill: either permission when not hidden; **`view_credit_dashboard` only** when hidden

Expose `hide_portfolio_health` on auth/session account payload like other product flags. Update seed/clone allowlists and account field copy for the new key and flag.

## How to test

1. Apply migration SQL locally (or CI migration runner on the branch).
2. Confirm `System_Administrator` has `view_portfolio_dashboard`; CFO with only `view_credit_dashboard` does not.
3. With hide off: `portfolio-health` OK with portfolio permission; 403 with only credit permission.
4. Set `hide_portfolio_health = true`: `portfolio-health` → 403 even with portfolio permission; Roles catalog omits the key; RolePermission rows for the key still exist in DB.
5. With hide on: as-of backfill status succeeds with credit permission; fails with portfolio-only permission.
6. Turn hide off again: catalog key returns; previous role grants still work without re-assigning.
