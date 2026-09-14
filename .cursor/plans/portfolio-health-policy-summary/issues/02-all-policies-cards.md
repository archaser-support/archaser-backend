# 02 — All-policies cards set page filter

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [01-tab-and-live-bullets](01-tab-and-live-bullets.md)
**User stories:** 9, 16, 17, 19
**PRD:** `.cursor/plans/portfolio-health-policy-summary.prd.md`

## What to build

When the policy dropdown is **All policies**, Policy summary shows a **short card per assigned policy** (same list as the dashboard policy dropdown, including Top-Up if the dropdown includes them). Each card is enough to identify the policy (number/status/kind; optional tiny limit/cost tease). **Clicking a card sets the page policy filter** so Health, Utilization, Costs, and No coverage match, and the tab shows that policy’s bullet summary (including **country and named counts**). English and Hebrew for card chrome in the same change. Reuse existing island cards; no Settings link.

## Acceptance criteria

- [ ] All policies + Policy summary shows one card per assigned dropdown policy
- [ ] Clicking a card updates the page policy dropdown / URL `policyId`
- [ ] After click, other Portfolio Health tabs are scoped to that policy
- [ ] After click, Policy summary shows the live bullet view (including country and named **counts**)
- [ ] Top-Up policies appear iff they appear in the existing policy dropdown
- [ ] Matching English and Hebrew locale keys are added/updated together

## How to test

1. On Portfolio Health, set the dropdown to **All policies**, stay on **Policy summary**. Expect a card per assigned policy.
2. Click a card. Expect the dropdown to that policy, bullets for it, and country/named **counts** (not tables).
3. Switch to Utilization (or Health). Expect data for that same policy, not All.
4. Hebrew: card labels translated.
