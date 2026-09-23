# 01 — Schema + API commercial terms (Primary only)

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1–8, 11, 13–19
**PRD:** `.cursor/plans/credit-insurance-policy-commercial-terms.prd.md`

## What to build

Add optional commercial-term fields on `InsurancePolicy` and expose them on insurance-policy create/get/update. Primary policies accept and return the values; TopUp saves clear them to null (same pattern as Primary-only pricing fields). Do not sync to `CustomerPolicy` or trend snapshots.

Fields: insured percentage; NQL (money); minimum premium (money) + period years; aggregate excess (money, 0 allowed); SDL excess (money, editable annual); NCB zero-claims bonus %, claims-ratio threshold %, up-to-threshold bonus %; product type enum (TailorMade | Commodity). Money amounts are in policy currency. Empty optional inputs store null; reject negatives / invalid percents when set.

## Acceptance criteria

- [x] Schema includes all commercial fields (nullable) plus product-type enum
- [x] Create/get/update round-trip the fields for Primary policies
- [x] TopUp create/update clears commercial fields
- [x] Aggregate excess `0` persists as `0` (distinct from null)
- [x] Empty optional fields persist as null
- [x] Invalid negative money/percent values are rejected when provided
- [x] Commercial fields are not pushed to `CustomerPolicy`

## How to test

1. Apply schema (`db push` per project rules — not migrate dev / force-reset).
2. Create a Primary policy via API with sample commercial values (e.g. insured 85, NQL 8750, min premium 1500000 / 3 years, aggregate excess 0, SDL excess 20002.5, NCB 22.5 / 20 / 15, product type TailorMade).
3. GET the policy — all values returned.
4. PATCH with aggregate excess null vs 0 — null clears, 0 remains 0.
5. Create or update a TopUp — commercial fields absent/null after save.
6. Confirm an existing Primary with no commercial fields still updates General fields successfully.
