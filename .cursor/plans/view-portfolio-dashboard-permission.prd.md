---
name: view-portfolio-dashboard-permission
overview: Add view_portfolio_dashboard for Portfolio Health; keep view_credit_dashboard for Credit Dashboard; optional account hide for Portfolio Health.
source: grill-me session / start-work
clickup_task_url: https://app.clickup.com/t/869fhw3h7
isProject: false
---

# View Portfolio Dashboard permission

## Problem Statement

Portfolio Health and Credit Dashboard share one permission (`view_credit_dashboard`). Admins cannot grant Credit Dashboard without also granting Portfolio Health (and vice versa). Roles UI labeling for the credit permission is also incomplete (hardcoded English fallback; missing locale keys). Separately, some accounts need Portfolio Health turned off entirely for the tenant—without removing Credit Insurance—so the permission must not appear in Roles and the menu item must not show.

## Solution

Introduce a new permission key `view_portfolio_dashboard` that gates Portfolio Health (nav, route access, and the `portfolio-health` API leaf). Keep `view_credit_dashboard` for Credit Dashboard. By default, only `System_Administrator` receives the new permission; other roles lose Portfolio Health until an admin assigns it. Roles UI shows **View Portfolio Health** in English and Hebrew.

Add an Account-level switch **Hide Portfolio Health** (`hide_portfolio_health`, default `false`) under Products, visible only when Credit Insurance is on. When hide is on: full block (nav, Roles catalog key, direct URL, and `portfolio-health` API). Existing role grants stay in the database but are hidden from Roles until hide is turned off. Shared as-of backfill still works with Credit Dashboard permission; Portfolio Health–only is not enough while hide is on.

## User Stories

1. As a security admin, I want a separate Portfolio Health permission, so that I can grant Credit Dashboard without opening Portfolio Health.
2. As a security admin, I want a separate Portfolio Health permission, so that I can grant Portfolio Health without granting Credit Dashboard.
3. As a System Administrator, I want Portfolio Health still available after the change by default, so that I am not locked out.
4. As a CFO (or other role that only had `view_credit_dashboard`), I want Credit Dashboard to keep working, so that my day-to-day credit work is unchanged.
5. As a CFO without the new permission, I want Portfolio Health hidden and its API denied, so that access matches my role.
6. As a Portfolio Health–only user, I want the Portfolio Health nav item and page to load, so that I can monitor portfolio health.
7. As a Portfolio Health–only user, I want shared as-of backfill and policy-picker calls from that screen to succeed, so that the page is usable without Credit Dashboard access (when the account has not hidden Portfolio Health).
8. As a Credit Dashboard–only user, I want Credit Dashboard APIs and nav to keep using `view_credit_dashboard`, so that existing grants remain valid.
9. As a security admin on a credit-insurance account (Portfolio Health not hidden), I want both dashboard permissions listed under dashboards in Roles, so that I can assign them.
10. As a security admin on a collection-only account, I want credit/portfolio dashboard permissions hidden, so that irrelevant keys do not clutter the catalog.
11. As a security admin on a credit-only account, I want `view_portfolio_dashboard` still available (like `view_credit_dashboard`) when Portfolio Health is not hidden, so that credit-only tenants can manage Portfolio Health access.
12. As a Hebrew-speaking admin, I want Hebrew labels for the new permission and the account switch, so that UI is fully localized.
13. As an English-speaking admin, I want the permission label **View Portfolio Health**, so that it matches the nav name.
14. As a user without either permission, I want direct URLs to Portfolio Health and Credit Dashboard blocked, so that deep links do not bypass nav.
15. As a product owner, I want Operation Dashboard and Financial Dashboard permissions unchanged, so that this work stays scoped to Portfolio Health.
16. As an account admin, I want a **Hide Portfolio Health** switch on the Account page (Products, only when Credit Insurance is on), so that I can turn Portfolio Health off for the whole account without disabling Credit Insurance.
17. As an account admin who hid Portfolio Health, I want the Roles page to stop showing `view_portfolio_dashboard`, so that nobody can assign a useless permission.
18. As an account admin who hid Portfolio Health, I want the Portfolio Health nav item gone for all users, so that the product surface disappears.
19. As a user on an account with Portfolio Health hidden, I want direct URL and `portfolio-health` API access denied, so that there is no back door.
20. As an account admin who later turns hide off, I want previous role grants for `view_portfolio_dashboard` still present, so that I do not have to re-check every role.
21. As a Credit Dashboard user on an account with Portfolio Health hidden, I want as-of backfill still to work with my credit permission, so that Credit Dashboard generate/backfill is not broken.

## Implementation Decisions

- **Permission key:** `view_portfolio_dashboard` (new). `view_credit_dashboard` remains for Credit Dashboard.
- **Default grant:** SQL migration under `prisma/migrations/` grants `view_portfolio_dashboard` only to `System_Administrator` (master account pattern + clone to accounts, idempotent). No copy-grant from existing `view_credit_dashboard` holders. Do not wrap migration SQL in top-level `BEGIN;` / `COMMIT;`.
- **Account flag:** `Account.hide_portfolio_health` Boolean `@default(false)`. Same migration (or adjacent SQL on the branch) adds the column. Prisma schema updated. Clone/demo account scripts copy the field with other account product flags.
- **Account UI:** Under Products on Admin → Accounts → General; label **Hide Portfolio Health** (EN+HE); show only when `has_credit_insurance` is true. Who can edit matches other account product switches.
- **Session / account products:** Expose `hide_portfolio_health` on the same session/account-products path as `has_credit_insurance` so nav and route guards can read it without an extra round trip.
- **Catalog:** Add the key to the global permission list and dashboards category. Show `view_portfolio_dashboard` only when the account has credit insurance **and** `hide_portfolio_health` is false. On credit-only accounts, keep it available when not hidden. Do **not** delete RolePermission rows when hide turns on.
- **API access:** `portfolio-health` requires `view_portfolio_dashboard` **and** account not hidden (`hide_portfolio_health` false) **and** credit insurance on. Credit Dashboard leaves keep requiring `view_credit_dashboard`. Shared as-of backfill leaves: when Portfolio Health is **not** hidden, accept either permission; when **hidden**, accept `view_credit_dashboard` only (Portfolio Health–only is not enough). Insurance-policy-trend alternate access stays as today for `view_credit_dashboard` / settings / update policy.
- **Frontend nav / shell / route guards:** Portfolio Health requires `view_portfolio_dashboard` and account products with credit insurance and not `hide_portfolio_health`. Credit Dashboard keeps `view_credit_dashboard`.
- **Roles UI:** Locale keys EN+HE for `view_portfolio_dashboard` → “View Portfolio Health” / Hebrew equivalent. Prefer locale over hardcoded English fallbacks; align `view_credit_dashboard` locale labels in the same change if still missing (parity, not rename). Catalog already omits the key when hide is on.
- **Reports contexts:** Credit-dashboard report contexts continue to check `view_credit_dashboard`. Do not invent portfolio-health report contexts in this work unless one already exists and is gated incorrectly.
- **Clone / seed scripts:** Update permission seed/demo-clone allowlists for the new key; copy `hide_portfolio_health` with account fields.
- **i18n:** Any new or changed user-facing strings ship EN+HE together.
- **Tests:** Do not add or expand automated tests unless explicitly requested later.

### Primary test seams

1. **Permission assignment seam** — RolePermission rows + catalog product filtering (credit insurance + hide flag; default SA grant).
2. **Access authorize seam** — credit-insurance leaf authorization (403 vs 200) for portfolio-health vs credit leaves vs shared backfill given keys and `hide_portfolio_health`.
3. **Frontend gate seam** — nav visibility + route accessibility for Portfolio Health vs Credit Dashboard, including hide flag from session account products.
4. **Account settings seam** — Products switch persistence and visibility only when Credit Insurance is on.

## Testing Decisions

- Prefer manual **How to test** on each vertical slice; do not require new automated tests unless asked.
- Good checks assert **observable access** (nav present/absent, page load, API 403/200, Roles catalog key present/absent, account switch save), not internal helper names.
- Prior art: existing credit-insurance HTTP checks for `view_credit_dashboard`; frontend route/nav unit tests that mention that key (update only if touched and tests already exist — still do not expand coverage unless asked).

## Out of Scope

- Renaming or removing `view_credit_dashboard`.
- Changing Operation / Financial dashboard permissions.
- Splitting as-of backfill into portfolio-only endpoints.
- Auto-granting the new permission to CFO, Data_Analyst, or other non–System_Administrator roles.
- Redesigning Portfolio Health or Credit Dashboard UI beyond permission gating, account hide, and roles/account labels.
- Report-builder feature work for Portfolio Health.
- Clearing RolePermission rows when hide turns on.

## Further Notes

- ClickUp: https://app.clickup.com/t/869fhw3h7
- Branch (primary repo): `feat/view-portfolio-dashboard-permission-CU-869fhw3h7`
- Users who previously reached Portfolio Health only via `view_credit_dashboard` will lose that access until an admin grants `view_portfolio_dashboard` (by design).
- Decision log (account hide grill): D1 available by default; D2 full block; D3 keep role grants; D4 Products switch when credit on; D5 `hide_portfolio_health`; D6 shared backfill needs credit permission when hidden; D7 label **Hide Portfolio Health**.
