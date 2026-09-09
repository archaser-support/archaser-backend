# 01 — Range-cost registration markup + monthly components

**Status:** done  
**Priority:** high  
**Blocked by:** —  
**User stories:** 1, 2, 3, 4, 5, 6, 13  
**PRD:** `.cursor/plans/portfolio-health-registration-fee-cost.prd.md`

## What to build

Extend Portfolio Health **range cost** so Policy cost includes **registration fee** as a markup on the insurance premium from the active cost method (Limit **or** Actual Sales for that day/invoice), and expose per-month component totals for the Costs UI.

Behavior:

1. For each insurance premium slice already computed by range cost, add  
   `registrationCost = insurancePremium × registration_fee_percent / 100`.
2. Use that day’s history `registration_fee_percent`; if null/missing → **0** (no fallback to today’s master policy).
3. Do **not** mark up top-up amortization.
4. Fold registration into period `periodCost` and into each month’s `totalCost`.
5. Return monthly breakdown fields (names as in PRD): insurance, registration, top-ups, and total — summing to the bar total.
6. Effective cost keeps using the updated period numerator ÷ average compliant exposure.

Load `registration_fee_percent` with the existing range-cost day inputs. Reuse existing approval, policy filter, BU scope, and invoice exclusions from range cost.

## Acceptance criteria

- [x] Actual Sales and Limit insurance premiums each get registration markup using that day/invoice’s historical registration % (null → 0).
- [x] Top-up slices are unchanged by registration.
- [x] Period Policy cost equals insurance + registration + top-ups over the range.
- [x] Each monthly point exposes insurance, registration, top-up, and total components; total equals the sum of the three parts.
- [x] Effective cost uses the new period cost when compliant exposure is non-zero.
- [x] A customer-day / invoice still uses only one cost method; registration never assumes both Limit and Actual Sales on the same row.

## How to test

1. Pick an account with a Primary policy that has Insurance Fee Rate and Registration Fee set (e.g. 2% and 50%), approved customers on Actual Sales and/or Limit, and optionally active top-ups.
2. Call or open Portfolio Health for a date range that includes issued invoices (Actual Sales) and/or Limit days; Generate history if needed so CPT has `cost_percent` and `registration_fee_percent`.
3. Confirm period Policy cost is higher than insurance+top-ups alone by roughly insurance × registration% / 100.
4. Inspect the costs API/section monthly points: each month’s three components + total are present and add up.
5. Spot-check a day/invoice where historical registration is null — that slice adds 0 registration.
6. Confirm top-up-only contribution months still show registration 0 and top-ups unchanged.
