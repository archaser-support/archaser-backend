# 02 — Date compare language (operators, datetime, literals)

**Status:** done
**Priority:** normal
**Blocked by:** [01-date-equality-yes-no](01-date-equality-yes-no.md)
**User stories:** 8–19, 40–41
**PRD:** `.cursor/plans/report-builder-formula-comparisons.prd.md`

## What to build

Complete the date compare language on top of slice 01 equality:

- Operators `!= < > <= >=` with calendar-day meaning for date-only fields.
- Date-and-time fields as operands; those compares use full date and time.
- Mix a date-only **field** with a date-and-time **field** by treating the date as UTC midnight.
- Typed dates `2026-03-01` only (no clock time, no quotes). Tokenize ISO dates as one literal so they are not parsed as subtraction.
- A date-and-time field compared to a typed date is Yes if it falls on that **calendar day**.

Reject adding/subtracting dates. Keep client and server parsers in lockstep. Translation permission required for new validation strings.

## Acceptance criteria

- [x] `!= < > <= >=` work for two date-only fields by calendar day, including on-or-before / on-or-after.
- [x] Two datetime fields on the same calendar day with different times are not equal.
- [x] Date field vs datetime field uses midnight-on-the-date, then datetime compare.
- [x] `[Invoice.invoice_date] = 2026-03-01` is valid; `2026-03-01` is not `2026 - 3 - 1`.
- [x] `[Invoice.created_at] = 2026-03-01` is Yes when created-at is that calendar day (including afternoon times).
- [x] Clock-time literals and date arithmetic (`date + date`) are rejected.

## How to test

1. Continue from slice 01’s Invoice report.
2. Try `!=`, `<`, `<=` between invoice date and due date on known rows (same day, earlier, later).
3. Add a datetime field (e.g. created at). Compare two datetimes that share a day but not a time → No for `=`.
4. Compare invoice date to created at (mixed types) and confirm the midnight rule.
5. Add `[Invoice.invoice_date] = 2026-03-01` and a row dated 1 Mar → Yes.
6. Compare created-at at 14:30 on 1 Mar to `2026-03-01` → Yes.
7. Confirm `2026-03-01 14:30` and `[Invoice.invoice_date] + [Invoice.due_date]` do not save.
