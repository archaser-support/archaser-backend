# 03 — Settings + report formula hint alignment

**Status:** done  
**Priority:** normal  
**Blocked by:** —  
**User stories:** 9, 10  
**PRD:** `.cursor/plans/portfolio-health-registration-fee-cost.prd.md`

## What to build

Align product copy so **Registration Fee (%)** means the same thing everywhere finance looks: a **percent of the insurance premium** (Portfolio Health D1), not a standalone percent of invoice amount.

1. Update settings/policy field help for Registration Fee (%) to state it is a share of the insurance fee (premium), 0–100.
2. Update Report Builder formula expression hint / redundant-division warning (and any in-code default strings that mirror them) so editors are steered to fee = premium × registration%, e.g.  
   `[Invoice.amount] * [Customer.cost_percent] * [Customer.registration_fee_percent]`  
   (rates already auto-scale ÷100 — do not tell users to divide again).

Can ship in parallel with slice 01. Does not change formula engine math — docs/hints only.

**Note:** Translation permission required for EN/HE `settings.json` and `reports.json` (and matching HE).

## Acceptance criteria

- [x] Settings/create/edit policy Registration Fee help clearly says % of insurance premium (not of sales/limit base alone).
- [x] Report formula hint/example guidance matches Portfolio Health (amount × cost% × registration% for the fee).
- [x] Auto-scale ÷100 guidance remains correct (no instructing `/100` on those fields).
- [x] EN and HE updated together when translation permission is granted.

## How to test

1. Open Settings → credit insurance policy create/edit; read Registration Fee (%) help/tooltip — wording matches “percent of insurance premium.”
2. Open Report Builder → add/edit a formula; read the expression hint — it does not push `amount × registration%` alone as the fee definition; D1-shaped example is clear.
3. Confirm redundant `/100` warning still makes sense with both rate fields.
4. Spot-check Hebrew locale for the same strings.
