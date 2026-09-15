# 01 — Policy Annual Credit Assessment Fee field

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6
**PRD:** `.cursor/plans/annual-credit-assessment-fee.prd.md`

## What to build

Add an optional **Annual Credit Assessment Fee** money field on the insurance policy (account currency). Users can set and save it on policy create/edit. Policy Summary on Portfolio Health shows the stored value. Null is allowed (treated as no fee / $0 later). Ship English and Hebrew labels together.

## Acceptance criteria

- [ ] Policy schema/API expose nullable non-negative Annual Credit Assessment Fee in account currency
- [ ] Create/edit policy form can set, clear, and persist the fee
- [ ] Policy Summary displays the fee with other cost settings
- [ ] Matching English and Hebrew locale keys are added/updated together

## How to test

1. Open insurance policy create/edit, set Annual Credit Assessment Fee (e.g. 500), save, reopen — value persists.
2. Clear the fee, save — field is empty/null.
3. Open Portfolio Health → Policy Summary for that policy — fee is visible.
4. Switch locale to Hebrew — field and summary labels are present (no English-only gaps).
