---
name: portfolio-health-policy-summary
overview: Add a first, default Policy summary tab on Portfolio Health that shows today’s insurance-policy settings as short emphasized bullets (not a full Settings form).
source: grill-me session via /start-work
clickup_task_url: https://app.clickup.com/t/869f1fh1p
isProject: false
---

# Portfolio Health policy summary tab

## Problem Statement

Reviewers on **Portfolio Health** can already filter by policy and see KPI tabs (health, no coverage, utilization, costs), but they cannot see the **contract settings** that explain those numbers without leaving for **Settings**. The Settings policy page is a long editor. They need a **short, emphasized summary** of the current policy in the same dashboard.

## Solution

Add a **Policy summary** pill as the **first** tab on Portfolio Health. It is the **default** when the URL has no `tab`. It shows **today’s live policy** from Settings (not the date-range snapshots). Copy is **read-only bullets**, with **limits and cost emphasized**; other contract facts (status, policy dates, insurer, payment terms, MEP, reporting days) as supporting bullets; **country caps and named customers as counts only**. No Open in Settings. Same header (dates, policy, business unit, KPI filters); dates and business unit **do not change this tab**. When the policy dropdown is **All policies**, show a **short card per assigned policy**; clicking a card **sets the page policy filter** (so other tabs match) and shows that policy’s bullets.

## User Stories

1. As a credit insurance user, I want a Policy summary tab on Portfolio Health, so that I can review contract settings next to dashboard KPIs.
2. As a credit insurance user, I want that tab first in the pill bar, so that I see settings before health charts.
3. As a credit insurance user, I want Portfolio Health to open on Policy summary when I do not pick a tab, so that the default matches the new first tab.
4. As a credit insurance user, I want an existing `tab=health` (or other tab) URL to still open that tab, so that bookmarks keep working.
5. As a credit insurance user, I want the summary to be read-only, so that I cannot edit the contract from the dashboard.
6. As a credit insurance user, I want today’s Settings values, so that I am not looking at a stale snapshot for the date range.
7. As a credit insurance user, I want limits and cost visually emphasized, so that the important facts stand out.
8. As a credit insurance user, I want status, policy dates, insurer, payment terms, MEP, and reporting days as bullets, so that I have enough context without the full form.
9. As a credit insurance user, I want country and named-customer **counts** only, so that I am not scrolling Settings grids.
10. As a credit insurance user, I want cutoff/substitute day fields omitted, so that the summary stays short.
11. As a credit insurance user, I want the same island look as other Portfolio Health tabs, so that the page feels like one dashboard.
12. As a credit insurance user, I want no Open in Settings action, so that editing stays in the Settings menu.
13. As a credit insurance user, I want the existing toolbar kept, so that switching tabs does not jump the layout.
14. As a credit insurance user, I accept that the date range does not change Policy summary, so that other tabs can keep their period.
15. As a credit insurance user, I want the business unit filter to leave Policy summary unchanged, so that account-level contract terms are not mis-scoped.
16. As a credit insurance user, I want All policies to show one card per assigned policy, so that I can pick what to review.
17. As a credit insurance user, I want clicking a card to set the page policy dropdown, so that Health, Utilization, Costs, and No coverage match the policy I just opened.
18. As a credit insurance user, I want a selected policy to skip the card list and show bullets immediately, so that the tab is useful after I already picked a policy.
19. As a credit insurance user, I want Top-Up policies in the card list if they appear in the dashboard policy dropdown, so that the list matches the filter.
20. As a credit insurance user, I want an empty state when there are no assigned policies, so that the tab is not blank without explanation.
21. As a credit insurance user, I want English and Hebrew labels for the tab and summary, so that locale users get matching copy.
22. As a credit insurance user, I want loading and error states when policy detail fails to load, so that I know the tab is not stuck.
23. As a credit insurance user, I want keyboard/ARIA tab behavior to stay consistent with existing pills, so that the new tab is not a special case.
24. As a developer, I want to reuse the live policy GET (including country and named arrays for counts) and the assigned-policy list already used by the dropdown, so that we do not add a new persistence model.
25. As a product owner, I want no schema or snapshot-cron changes, so that this stays a dashboard review surface.

## Implementation Decisions

- **Tab id:** `policy-summary`, first in `PORTFOLIO_HEALTH_TAB_IDS`. `parsePortfolioHealthTab` defaults to `policy-summary` when `tab` is missing or unknown (today it defaults to `health`). Keep explicit `tab=health|no-coverage|utilization|costs` working.
- **Data:** Live `GET` insurance-policy by id (same payload Settings uses: header plus country and named includes). Do **not** use insurance-policy-trend snapshots or the Portfolio Health date-range KPI API for this tab’s bullets. Do **not** add a new Prisma model.
- **List:** Same assigned-policy source as `CreditDashboardPolicySelect` (`assigned_only=1`). Cards only when `policyId` is null.
- **Card click:** Call the existing page `onPolicyScopeChange` with that id (URL `policyId` updates). Then render the bullet summary for that id.
- **Bullet mapping (live fields):**
  - Emphasize: `max_total_cover`, `max_total_dcl_sdl_cover` / `max_dcl` as relevant, `cost_percent`, `registration_fee_percent`, `cost_calculation_method`.
  - Supporting: `status`, `policy_kind`, `policy_number`, `insurer_name`, `start_date`, `end_date`, `max_payment_term`, `max_allowed_mep`, `reporting_days`.
  - Counts: length of `InsurancePolicyCountry` and `NamedPolicy` (or equivalent keys on the GET payload).
  - Omit: cutoff/substitute days, score/DCL tenure rules, concurrent top-up flags, named/country row tables, Settings editor chrome.
- **Presentation:** Reuse Portfolio Health island cards, type, and tokens. Emphasize limits and cost with existing KPI/stat patterns on that screen (large numbers), not new global styles. **Styling:** no new theme blocks or CSS classes without explicit approval; reuse `IslandCard`, `PillTabs`, `StatNumber` / `BigNumber` as they already exist.
- **i18n:** New `credit_portfolio_health` keys in English and Hebrew `dashboard.json` in the same change (tab label, empty states, bullet labels, counts). Reuse existing credit-insurance field labels where they already exist if they fit; do not leave English-only `defaultValue` gaps.
- **Permissions:** Anyone who can open Portfolio Health (`view_credit_dashboard`) can read this tab. Reuse existing DualAuth policy GET; do not require `update_insurance_policy`.
- **No Settings deep-link.**
- **Header:** Do not hide date range, excluded-customer, or ignore-reporting-breach controls on this tab.
- **Intro overlay:** Leave cinematic intro as-is unless a follow-up asks to mention Policy summary in status lines.
- **Tests:** Do not add or expand automated tests unless the user asks.

## Testing Decisions

- Prefer **manual How to test** on slices (tab order, default URL, All vs one policy, click sets filter, bullets vs omitted fields, locale).
- A good check is **external behavior**: what the user sees after navigation and filter changes, not private component state.
- Prior art: existing Portfolio Health screen (`PillTabs`, URL `tab` + `policyId`), Settings policy GET payload, Credit Dashboard policy dropdown.
- Highest seam: the Portfolio Health page with live policy GET — no new backend seam unless GET is insufficient for counts (it already includes country and named arrays for Settings).

## Out of Scope

- Embedding or reusing the Settings editor / `PolicyGeneralInfo` form.
- Open in Settings, editing, or write APIs.
- Historical / as-of policy from trend snapshots; flagging fields that changed in the date range.
- Full country or named-customer tables.
- Hiding toolbar filters on this tab.
- Scoping bullets by business unit.
- Schema, cron, or snapshot changes.
- New automated tests unless requested.
- New visual styles beyond existing Portfolio Health islands (needs explicit approval).
- Credit Dashboard (non–Portfolio Health) policy summary panel.

## Further Notes

Grill locked 2026-09-14. ClickUp: https://app.clickup.com/t/869f1fh1p. Primary repo: backend (planning); implementation will touch frontend first. Parked unrelated billing planning WIP on `fix/at-risk-cap-gap-terms-overlap` via git stash `park billing planning WIP before CU-869f1fh1p`.

### Codebase scan

**Required**

- Frontend `PillTabs` tab ids, icons, parse default.
- Frontend `CreditPortfolioHealthScreen` panel switch + labels.
- Frontend `credit-portfolio-health/page.tsx` URL `tab` / `policyId` seeding.
- Frontend locales `en/dashboard.json` and `he/dashboard.json` under `credit_portfolio_health`.
- New Policy summary view (island + bullets) in the credit-portfolio-health feature folder.
- Live policy GET already used by Settings (`/api/entities/insurance-policies/:id`).
- Existing assigned-policy list used by `CreditDashboardPolicySelect`.

**Optional / out of scope unless requested**

- Intro overlay status lines (`usePortfolioHealthIntro`).
- Navigation copy in `common.json` (page title already “Portfolio Health”).
- Backend `assigned_only` list behavior if the dropdown already works in this environment.
- Unit tests under `frontend/unit` or `tests/` for tab parse / view-model.

**No change needed**

- Prisma `InsurancePolicy` / trend tables — read live row only.
- Portfolio Health KPI service (`getCreditPortfolioHealth`) — date-range tabs unchanged.
- Insurance policy Settings page and permissions for update.
- Credit Dashboard screen (separate route).
- Report metadata / export mappers.
- Hebrew/English credit_insurance field dictionaries except where we choose to reuse keys.

### Plan improvements

- Easy to miss: default tab change is a **behavior break** for users who land without `tab=` (intentional). Document in How to test.
- Easy to miss: GET payload key names (`InsurancePolicyCountry` vs `countries`) must match the entity serializer Settings already consumes.
- Incorrect assumption to avoid: export/report “policy summary” and credit-insurance `/summary` are **not** this tab.
- Follow-up (out of scope): as-of snapshot comparison, Settings link for editors, intro copy for the new tab.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/portfolio-health-policy-summary/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/portfolio-health-policy-summary/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Policy summary tab + live bullets for one policy | `issues/01-tab-and-live-bullets.md` | — | 1–8, 10–15, 18, 20–25 |
| 2 | All-policies cards set page filter | `issues/02-all-policies-cards.md` | 01 | 9, 16–17, 19 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
