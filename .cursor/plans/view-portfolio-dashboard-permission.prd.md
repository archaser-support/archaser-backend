---
name: view-portfolio-dashboard-permission
overview: Add view_portfolio_dashboard for Portfolio Health; keep view_credit_dashboard for Credit Dashboard.
source: grill-me session / start-work
clickup_task_url: https://app.clickup.com/t/869fhw3h7
isProject: false
---

# View Portfolio Dashboard permission

## Problem Statement

Portfolio Health and Credit Dashboard share one permission (`view_credit_dashboard`). Admins cannot grant Credit Dashboard without also granting Portfolio Health (and vice versa). Roles UI labeling for the credit permission is also incomplete (hardcoded English fallback; missing locale keys).

## Solution

Introduce a new permission key `view_portfolio_dashboard` that gates Portfolio Health (nav, route access, and the `portfolio-health` API leaf). Keep `view_credit_dashboard` for Credit Dashboard. By default, only `System_Administrator` receives the new permission; other roles lose Portfolio Health until an admin assigns it. Roles UI shows **View Portfolio Health** in English and Hebrew. Shared credit-insurance helpers used from Portfolio Health (as-of backfill status/start/pause/retry, and policy picker flows) accept **either** permission so a user with only one key can still use those helpers when needed.

## User Stories

1. As a security admin, I want a separate Portfolio Health permission, so that I can grant Credit Dashboard without opening Portfolio Health.
2. As a security admin, I want a separate Portfolio Health permission, so that I can grant Portfolio Health without granting Credit Dashboard.
3. As a System Administrator, I want Portfolio Health still available after the change by default, so that I am not locked out.
4. As a CFO (or other role that only had `view_credit_dashboard`), I want Credit Dashboard to keep working, so that my day-to-day credit work is unchanged.
5. As a CFO without the new permission, I want Portfolio Health hidden and its API denied, so that access matches my role.
6. As a Portfolio Health–only user, I want the Portfolio Health nav item and page to load, so that I can monitor portfolio health.
7. As a Portfolio Health–only user, I want shared as-of backfill and policy-picker calls from that screen to succeed, so that the page is usable without Credit Dashboard access.
8. As a Credit Dashboard–only user, I want Credit Dashboard APIs and nav to keep using `view_credit_dashboard`, so that existing grants remain valid.
9. As a security admin on a credit-insurance account, I want both dashboard permissions listed under dashboards in Roles, so that I can assign them.
10. As a security admin on a collection-only account, I want credit/portfolio dashboard permissions hidden, so that irrelevant keys do not clutter the catalog.
11. As a security admin on a credit-only account, I want `view_portfolio_dashboard` still available (like `view_credit_dashboard`), so that credit-only tenants can manage Portfolio Health access.
12. As a Hebrew-speaking admin, I want Hebrew labels for the new permission, so that Roles UI is fully localized.
13. As an English-speaking admin, I want the label **View Portfolio Health**, so that it matches the nav name.
14. As a user without either permission, I want direct URLs to Portfolio Health and Credit Dashboard blocked, so that deep links do not bypass nav.
15. As a product owner, I want Operation Dashboard and Financial Dashboard permissions unchanged, so that this work stays scoped to Portfolio Health.

## Implementation Decisions

- **Permission key:** `view_portfolio_dashboard` (new). `view_credit_dashboard` remains for Credit Dashboard.
- **Default grant:** SQL migration under `prisma/migrations/` grants `view_portfolio_dashboard` only to `System_Administrator` (master account pattern + clone to accounts, idempotent). No copy-grant from existing `view_credit_dashboard` holders. Do not wrap migration SQL in top-level `BEGIN;` / `COMMIT;`.
- **Catalog:** Add the key to the global permission list and dashboards category. Product filter: show only when the account has credit insurance (same as `view_credit_dashboard`). On credit-only accounts, keep it available (do not strip it with collection dashboard keys).
- **API access:** Extend credit dashboard access authorization so `portfolio-health` requires `view_portfolio_dashboard`. Credit Dashboard leaves continue to require `view_credit_dashboard`. Shared leaves used by Portfolio Health (as-of backfill status/start/pause/retry) accept **either** `view_portfolio_dashboard` or `view_credit_dashboard`. Insurance-policy-trend alternate access rules stay as today (still consider `view_credit_dashboard`, not the new key, unless already covered by settings/update policy).
- **Frontend nav / shell / route guards:** Portfolio Health uses `view_portfolio_dashboard`. Credit Dashboard keeps `view_credit_dashboard`.
- **Roles UI:** Locale keys EN+HE for `view_portfolio_dashboard` → “View Portfolio Health” / Hebrew equivalent. Prefer locale over hardcoded English fallbacks; align `view_credit_dashboard` locale labels in the same change if still missing (parity, not rename).
- **Reports contexts:** Credit-dashboard report contexts continue to check `view_credit_dashboard`. Do not invent portfolio-health report contexts in this work unless one already exists and is gated incorrectly.
- **Clone / seed scripts:** Update any permission seed or demo-clone allowlists that list dashboard permissions so the new key is recognized where credit permissions are cloned.
- **i18n:** Any new or changed user-facing strings ship EN+HE together.
- **Tests:** Do not add or expand automated tests unless explicitly requested later.

### Primary test seams

1. **Permission assignment seam** — RolePermission rows + catalog product filtering (can the role see/assign the key; default SA grant).
2. **Access authorize seam** — credit-insurance leaf authorization outcomes (403 vs 200) for portfolio-health vs credit leaves vs shared backfill leaves given one or both keys.
3. **Frontend gate seam** — nav visibility + route accessibility for Portfolio Health vs Credit Dashboard.

## Testing Decisions

- Prefer manual **How to test** on each vertical slice; do not require new automated tests unless asked.
- Good checks assert **observable access** (nav present/absent, page load, API 403/200), not internal helper names.
- Prior art: existing credit-insurance HTTP checks for `view_credit_dashboard`; frontend route/nav unit tests that mention that key (update only if touched and tests already exist — still do not expand coverage unless asked).

## Out of Scope

- Renaming or removing `view_credit_dashboard`.
- Changing Operation / Financial dashboard permissions.
- Splitting as-of backfill into portfolio-only endpoints.
- Auto-granting the new permission to CFO, Data_Analyst, or other non–System_Administrator roles.
- Redesigning Portfolio Health or Credit Dashboard UI beyond permission gating and roles labels.
- Report-builder feature work for Portfolio Health.

## Further Notes

- ClickUp: https://app.clickup.com/t/869fhw3h7
- Branch (primary repo): `feat/view-portfolio-dashboard-permission-CU-869fhw3h7`
- Users who previously reached Portfolio Health only via `view_credit_dashboard` will lose that access until an admin grants `view_portfolio_dashboard` (by design).
