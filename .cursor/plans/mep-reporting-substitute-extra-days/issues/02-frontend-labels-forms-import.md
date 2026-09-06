# 02 — Frontend labels, forms, and import UI

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [01-backend-rename-math-validation](01-backend-rename-math-validation.md)
**User stories:** 5, 6, 7, 8, 9, 10, 17
**PRD:** `.cursor/plans/mep-reporting-substitute-extra-days.prd.md`

## What to build

Update customer and insurance-policy UIs, customer-policy adapter/types, and policy-import field catalogs to use `mep_substitute_extra_days` / `reporting_substitute_extra_days`. Show labels “MEP Substitute Extra Days” / “Reporting Substitute Extra Days” (and matching Hebrew). Validate 1–365 on those fields; keep cutoff and payment-term substitute on day-of-month rules. Keep pair UX (required together; clearing cutoff clears substitute). Update EN/HE settings and import copy for names, help text, and validation errors. Align import processor sample/expected columns with the hard rename (no old aliases).

## Acceptance criteria

- [ ] Customer + policy forms read/write the new field keys and labels
- [ ] Client validation allows 1–365 for extra-days fields and still pairs with cutoff
- [ ] EN + HE translations updated for labels, import descriptions, and validation messages
- [ ] Import UI / field list shows new headers only
- [ ] Payment Term substitute UI remains day-of-month naming and 1–31 validation

## How to test

1. On a credit-insurance customer edit form, confirm MEP/Reporting substitute labels and that values 1 and 365 save; 0 and 366 fail.
2. Set cutoff without substitute (and the reverse); confirm pair validation errors.
3. Clear MEP cutoff; confirm substitute clears.
4. Open insurance policy create/edit; confirm the same labels/validation.
5. Open policy import mapping; confirm new field names/descriptions and no old substitute day-of-month headers.
6. Smoke-check Payment Term substitute still labeled as day-of-month and rejects 32.
