# 02 — Purpose tooltips on all credit KPI cards

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 24, 27
**PRD:** `.cursor/plans/bucket1-ctp-kpis.prd.md`

## What to build

Ensure every KPI card on Customer credit dashboard cards, Credit dashboard, and Portfolio Health shows a short **purpose** explanation on tooltip hover (why the metric exists / what decision it supports)—not only formula restatement. Cover all **existing** cards on those three surfaces in this slice; new KPI cards from later slices must follow the same pattern when added. Update English and Hebrew locale keys together. Reuse existing tooltip / `CreditMetricCard` patterns (`placement="bottom"`).

## Acceptance criteria

- [ ] Every existing KPI card on the three surfaces has a purpose-oriented tooltip
- [ ] Matching EN and HE keys updated together with no English-only `defaultValue` gaps for these strings
- [ ] Tooltips use bottom placement consistent with project tooltip rules
- [ ] No drive-by unrelated copy edits

## How to test

1. Open Credit dashboard → hover each metric card → purpose text appears below the trigger.
2. Open Portfolio Health (each tab with KPI cards) → same check.
3. Open a customer with credit insurance cards → same check.
4. Switch locale to Hebrew and spot-check several cards for translated purpose text.
