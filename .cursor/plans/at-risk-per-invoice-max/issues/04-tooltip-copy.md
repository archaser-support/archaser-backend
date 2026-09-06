# 04 — EN/HE at-risk tooltips

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** —
**User stories:** 14
**PRD:** `.cursor/plans/at-risk-per-invoice-max.prd.md`

## What to build

Update English and Hebrew dashboard tooltip / help strings for at-risk exposure so they describe per-invoice `max(capacity gap, terms breach)` and the sum across invoices, uncovered → full open AR, and no portfolio residual. Do not change styling.

Work in the frontend repo on the same branch name when editing locale files.

## Acceptance criteria

- [ ] EN at-risk metric tooltip matches the new formula
- [ ] HE at-risk metric tooltip matches the new formula
- [ ] No unrelated translation keys changed

## How to test

1. Open customer Dashboard and credit dashboard At Risk tooltips in English.
2. Confirm copy describes per-invoice max(gap, breach) and sum; uncovered full AR; no old “gap + terms breach” / policy residual wording.
3. Switch to Hebrew and confirm the same meaning.
