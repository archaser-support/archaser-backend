# 01 — Account VAT setting + open-AR basis helper

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 10, 15
**PRD:** `.cursor/plans/account-vat-include-exclude.prd.md`

## What to build

Add the account include/exclude VAT setting (default include) with API read/write and admin UI on account settings. Changing the switch shows a confirmation dialog (Cancel keeps the previous value; Confirm persists). Full account-wide rollup enqueue/progress is owned by slice 03 — this slice may stub or no-op the enqueue hook so the setting saves cleanly. Introduce a shared helper that, given the account setting and an invoice’s with-VAT outstanding plus without-VAT / with-VAT amounts, returns the open-AR contribution used by later slices (gross when include or when VAT fields missing; scaled when exclude). Ship English and Hebrew labels for the setting and confirm dialog.

## Acceptance criteria

- [x] Account persists include vs exclude VAT; default is include
- [x] Account admin can view the setting; changing it requires confirm (Cancel does not save)
- [x] Shared helper implements include / scale / missing-fields rules from the PRD
- [x] Matching English and Hebrew locale keys for the setting and confirm copy

## How to test

1. Open an account in admin → General (or account settings). Confirm the VAT toggle defaults to include.
2. Flip toward exclude — confirm dialog appears; Cancel leaves include; Confirm persists exclude after reload.
3. Spot-check Hebrew locale for the setting and dialog.
4. (Dev) Call the helper with sample invoice amounts: include → full outstanding; exclude with both amounts → scaled; exclude with missing without-VAT → full outstanding.
