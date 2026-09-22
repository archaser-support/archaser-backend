# 02 — Invoice VAT fields, import, unpaid list, report builder

**Status:** done
**Priority:** high
**Blocked by:** [01-account-vat-setting-basis-helper](01-account-vat-setting-basis-helper.md)
**User stories:** 5, 6, 12, 14
**PRD:** `.cursor/plans/account-vat-include-exclude.prd.md`

## What to build

Persist invoice without-VAT and VAT amount alongside existing with-VAT `amount`. Wire optional import mapping, expose fields on invoice APIs as needed, add unpaid invoice table columns (with VAT / without VAT / VAT amount), and register the new invoice fields in report builder metadata. English and Hebrew labels for columns and report fields. Do not add duplicate without-VAT customer rollup fields.

## Acceptance criteria

- [x] Invoice stores without-VAT and VAT amount; `amount` remains with-VAT
- [x] Import can map the new fields; omitted fields leave lines unscaled under exclude mode
- [x] Unpaid invoice list shows the three amount columns
- [x] Report builder metadata includes the new invoice fields
- [x] Matching English and Hebrew locale keys

## How to test

1. Import or edit an invoice with with-VAT, without-VAT, and VAT amount; confirm values on the unpaid invoices list.
2. Open report builder → Invoice fields; confirm without-VAT and VAT amount appear.
3. Spot-check Hebrew column/report labels.
4. Leave without-VAT empty on one invoice; confirm it still imports and displays.
