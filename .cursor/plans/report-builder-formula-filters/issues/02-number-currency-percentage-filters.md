# 02 — Number, currency, and percentage formula filters

**Status:** done
**Priority:** normal
**Blocked by:** [01-yes-no-formula-filter-e2e](01-yes-no-formula-filter-e2e.md)
**User stories:** 5–8, 34, 39, 40
**PRD:** `.cursor/plans/report-builder-formula-filters.prd.md`

## What to build

Extend formula filters so **Number**, **Currency**, and **Percentage** formulas use the same number-style operators as amount fields (equals, not equals, greater/less and or-equal, is empty, is not empty). Compare against the **raw** numeric formula value. Percentage filter values are fractions (0.15 means 15%); add short helper or validation copy so editors are not confused with whole percents. Reuse the compute-then-filter-then-paginate path from slice 01. Yes/No operator/value rules from slice 01 stay unchanged. EN+HE together for any new copy.

## Acceptance criteria

- [x] Number and Currency formulas offer the full number/decimal operator set in builder and viewer.
- [x] Percentage formulas use the same operators; filter values compare as raw fractions (e.g. greater than `0.10` keeps rows showing 15%).
- [x] Helper or validation copy clarifies percentage raw values (EN+HE).
- [x] A greater-than filter on a number formula yields correct rows and `totalRecords` across pages.
- [x] Blank formula results still match only empty / not empty.
- [x] Matching English and Hebrew locale keys are added/updated together for new copy in this slice.

## How to test

1. Open a report with a Number or Currency formula (e.g. amount math) and a Percentage formula if available.
2. Filter Number/Currency with greater than a known threshold; confirm only matching rows and a correct total.
3. Filter Percentage with a raw fraction (e.g. greater than 0.1) and confirm rows that display above 10% remain.
4. Confirm Yes/No formula filters from slice 01 still work and still lack greater/less operators.
5. Spot-check Hebrew for the percentage hint/validation copy.
