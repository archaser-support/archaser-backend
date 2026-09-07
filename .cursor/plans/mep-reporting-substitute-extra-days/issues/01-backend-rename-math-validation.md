# 01 — Backend rename, validation, and target-date math

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 11, 12, 14, 15, 16, 18
**PRD:** `.cursor/plans/mep-reporting-substitute-extra-days.prd.md`

## What to build

Rename `mep_substitute_day_of_month` / `reporting_substitute_day_of_month` to `mep_substitute_extra_days` / `reporting_substitute_extra_days` across Prisma models (Insurance Policy, Customer Policy, Customer Policy Trend), domain loaders, customer-policy APIs, and policy import. Preserve existing numeric values on rename.

Change MEP and Reporting target-date calculation so that when cutoff applies, the result is `due_date + offset + substitute_extra_days`. Keep Payment Term on the existing next-month day-of-month diff. Validate MEP/Reporting substitute as integers 1–365; leave cutoff and payment-term substitute on 1–31. Import accepts only the new header names (no old aliases). Do not run a bulk rewrite of invoice target dates.

## Acceptance criteria

- [x] Schema/API fields renamed; stored values preserved
- [x] On/after cutoff: MEP/Reporting targets use original target + extra days
- [x] Before cutoff / unset pair: targets remain due + offset only
- [x] Payment Term substitute formula and field names unchanged
- [x] Validation: extra days 1–365; day-of-month fields still 1–31; pairs still required together
- [x] Policy import uses new headers only
- [x] No one-off invoice target backfill

## How to test

1. Apply schema rename locally; confirm existing Customer Policy / Insurance Policy rows still show the same numbers under the new column names.
2. With MEP cutoff 24 and `mep_substitute_extra_days` 2, `max_allowed_mep` 30: create or refresh an invoice dated 2026-06-24 due 2026-06-26; expect `target_mep_date` = 2026-07-28.
3. Same customer, invoice dated 2026-06-10; expect `target_mep_date` = due + 30 only.
4. Repeat 2–3 for Reporting with `reporting_days` and `reporting_substitute_extra_days`.
5. Confirm payment-term cutoff/substitute still adjusts the allowed term via the old next-month-day gap (not plain +N days).
6. Import a policy row with the new substitute headers; confirm success. Retry with old `*_substitute_day_of_month` headers and confirm failure.
