# 01 — Policy summary tab + live bullets for one policy

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 18, 20, 21, 22, 23, 24, 25
**PRD:** `.cursor/plans/portfolio-health-policy-summary.prd.md`

## What to build

Add **Policy summary** as the **first** Portfolio Health pill and the **default** tab when the URL has no `tab`. When a **single policy** is selected (or the account has no policies), render a **read-only** island summary of **today’s** live policy: **limits and cost emphasized**; supporting bullets for status, policy dates, insurer, payment terms, MEP, reporting days. Omit cutoff/substitute fields and Settings grids. No Open in Settings. Keep the existing header; dates and business unit do not change this content. Loading, error, and empty (no assigned policies) states. English and Hebrew copy in the same change. Reuse existing live policy GET and Portfolio Health island/tab patterns — no new API or schema.

When **All policies** is selected, this slice may show a short empty/prompt state (cards are slice 02); do not block shipping the selected-policy summary.

## Acceptance criteria

- [ ] Policy summary is the first pill and opens by default when `tab` is absent
- [ ] Explicit `tab=health` (and other existing tab ids) still open those tabs
- [ ] With one policy selected, the tab shows live Settings values (not date-range KPIs)
- [ ] Limits and cost are visually stronger than the other bullets
- [ ] Supporting bullets include status, dates, insurer, payment terms, MEP, reporting days
- [ ] Cutoff/substitute days and full country/named tables are not shown
- [ ] No Open in Settings control
- [ ] Header (dates, policy, filters) stays visible; changing dates or business unit does not change the bullets
- [ ] Empty and error/loading states are understandable
- [ ] Matching English and Hebrew locale keys are added/updated together
- [ ] No new global styles without explicit approval; reuse Portfolio Health islands and stats

## How to test

1. Open **Portfolio Health** from the menu (no `tab` in the URL). Expect **Policy summary** selected first.
2. Pick one policy in the dropdown. Expect bullets for that policy: large limits/cost, shorter supporting facts. Change the date range; bullets stay the same. Change business unit; bullets stay the same.
3. Set `tab=health` in the URL. Expect the old Portfolio Health tab. Switch back to Policy summary; other KPI tabs still work.
4. If the account has no assigned policies, expect an empty explanation, not a crash.
5. Switch the UI to Hebrew: tab label and bullet labels are translated.
