# 02 — Frontend nav, route gates, and roles labels

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [01-permission-catalog-and-api](01-permission-catalog-and-api.md)
**User stories:** 5, 6, 12, 13, 14, 15
**PRD:** `.cursor/plans/view-portfolio-dashboard-permission.prd.md`

## Deliverable

Wire Portfolio Health nav, AppShell, and route accessibility to `view_portfolio_dashboard`. Keep Credit Dashboard on `view_credit_dashboard`. Add EN+HE roles labels for `view_portfolio_dashboard` as **View Portfolio Health** (and Hebrew equivalent). Prefer locale keys over hardcoded English fallbacks; add missing `view_credit_dashboard` locale entries in the same change if still absent. Do not change Operation / Financial dashboard gating.

## How to test

1. Sign in as System_Administrator (has both keys after slice 01): both Credit Dashboard and Portfolio Health appear; both pages load.
2. Sign in as a role with only `view_credit_dashboard`: Credit Dashboard visible; Portfolio Health hidden; direct `/app/credit-portfolio-health` blocked or redirected.
3. Sign in as a role with only `view_portfolio_dashboard`: Portfolio Health visible and loads; Credit Dashboard hidden.
4. Open Settings → Roles on a credit-insurance account: see **View Portfolio Health** (EN) and Hebrew label when locale is HE; assign/revoke and confirm nav updates after refresh/session.
5. Confirm Operation Dashboard still uses `view_operation_dashboard` unchanged.
