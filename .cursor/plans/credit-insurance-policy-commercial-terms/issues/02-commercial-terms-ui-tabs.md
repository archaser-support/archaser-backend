# 02 — Commercial terms tab + modal + i18n

**Status:** done
**Priority:** normal
**Blocked by:** [01-schema-api-commercial-terms](01-schema-api-commercial-terms.md)
**User stories:** 9–12, 16–18
**PRD:** `.cursor/plans/credit-insurance-policy-commercial-terms.prd.md`

## What to build

On the policy detail page, add two tabs: **General** (existing content) and **Commercial terms** (new form for the commercial fields). On create/edit modal for Primary, add a Commercial section with the same fields. Hide commercial UI for TopUp. Ship English and Hebrew labels/tab titles/validation together. Reuse existing form patterns; no new global theme blocks unless approved.

## Acceptance criteria

- [x] Policy detail shows General + Commercial terms tabs
- [x] Commercial tab loads/saves all commercial fields via the existing policy save path
- [x] Create/edit modal shows Commercial section for Primary only
- [x] TopUp hides commercial fields
- [x] EN + HE locale keys added for tab, labels, and validation
- [x] Optional empties and aggregate excess 0 behave correctly in the UI

## How to test

1. Open Settings → Credit Insurance → open a Primary policy.
2. Confirm two tabs: General and Commercial terms.
3. On Commercial terms, enter Idigital-style sample values, save, reload — values stick.
4. Clear aggregate excess to empty vs type `0` — empty becomes unset; `0` remains zero.
5. Switch locale to Hebrew — tab title and field labels show Hebrew (e.g. אחוז כיסוי ביטוחי, סף כיסוי לפוליסה).
6. Open create Primary modal — Commercial section present; create TopUp — commercial section hidden.
7. Confirm General tab still edits cover/pricing/terms as before.
