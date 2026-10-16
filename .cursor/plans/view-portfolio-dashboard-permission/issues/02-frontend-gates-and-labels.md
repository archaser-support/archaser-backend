# 02 — Frontend nav, route gates, and roles labels

**Status:** done
**Priority:** normal
**Blocked by:** [01-permission-catalog-and-api](01-permission-catalog-and-api.md)
**User stories:** 5, 6, 12, 13, 14, 15, 18, 19
**PRD:** `.cursor/plans/view-portfolio-dashboard-permission.prd.md`

## Deliverable

Wire Portfolio Health nav, AppShell, and route accessibility to `view_portfolio_dashboard` **and** account products: credit insurance on and `hide_portfolio_health` false. Keep Credit Dashboard on `view_credit_dashboard`. Add EN+HE roles labels for `view_portfolio_dashboard` as **View Portfolio Health**. Prefer locale keys over hardcoded English fallbacks; add missing `view_credit_dashboard` locale entries if still absent. Do not change Operation / Financial dashboard gating. Consume `hide_portfolio_health` from session/account products (wired in slice 01).

## How to test

1. System_Administrator, hide off: both Credit Dashboard and Portfolio Health appear and load.
2. Role with only `view_credit_dashboard`, hide off: Credit Dashboard visible; Portfolio Health hidden; direct `/app/credit-portfolio-health` blocked.
3. Role with only `view_portfolio_dashboard`, hide off: Portfolio Health visible; Credit Dashboard hidden.
4. Account with hide on (any role): Portfolio Health nav gone; direct URL blocked; Roles does not list View Portfolio Health.
5. Settings → Roles (credit, hide off): EN/HE **View Portfolio Health**; Operation Dashboard still uses `view_operation_dashboard`.
