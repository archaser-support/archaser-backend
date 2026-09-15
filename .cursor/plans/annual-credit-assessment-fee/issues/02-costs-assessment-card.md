# 02 — Costs tab Annual Credit Assessment card

**Status:** done
**Priority:** normal
**Blocked by:** [01-policy-fee-field](01-policy-fee-field.md)
**User stories:** 7, 8, 9, 10, 11, 12, 18
**PRD:** `.cursor/plans/annual-credit-assessment-fee.prd.md`

## What to build

On Portfolio Health **Costs**, add a standalone card for total Annual Credit Assessment cost:

`Σ over policies (current fee × named customers named anytime in range × yearMultiplier)`

where `yearMultiplier = max(1, ceil(inclusiveDays / 365))`.

Do **not** change existing Policy cost (`periodCost`), monthly/daily cost series, or effective cost. Null fee contributes $0. Introduce a shared year-multiplier helper reused by Utilization.

## Acceptance criteria

- [x] Costs tab shows assessment total using named-anytime-in-range × fee × ceil years
- [x] Multi-policy (no filter) sums per policy with each policy’s current fee
- [x] Existing Policy cost / charts / effective cost unchanged
- [x] Year-multiplier helper exists and matches `max(1, ceil(inclusiveDays / 365))`
- [x] Matching English and Hebrew locale keys are added/updated together

## How to test

1. Set fee on a policy with known named customers; open Costs for a range ≤ 1 year — total ≈ fee × named-in-range count.
2. Extend the range past 365 inclusive days — total scales by ceil years (e.g. 366 days → ×2).
3. Confirm Policy cost / monthly bars / effective cost numbers match pre-change behavior for the same range.
4. Hebrew locale: new card labels present.
