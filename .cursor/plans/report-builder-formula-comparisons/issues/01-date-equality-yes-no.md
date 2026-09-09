# 01 — Date equality Yes/No from builder to export

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1–7, 11, 24–30, 39–45
**PRD:** `.cursor/plans/report-builder-formula-comparisons.prd.md`

## What to build

Make a formula that can compare two **date-only** fields with `=` and show **Yes** or **No** from the formula editor through the report viewer and CSV/Excel (and the existing PDF/scheduled formatted-value path).

Editors can insert date-only fields (at least `Invoice.invoice_date` and `Invoice.due_date`). Same **calendar day** (UTC, matching how date columns display) is Yes; different days are No. Missing or invalid dates stay **blank**, not No. Raw value is `1` / `0`. Editors pick **Yes/No** as a fourth format (default for new formulas stays Number). Keep existing arithmetic formulas working.

Parser copies on client and server must stay in lockstep. Do not add `!= < >` literals, datetime, or number compares in this slice. Translation file edits need explicit permission at implement time.

## Acceptance criteria

- [x] `[Invoice.invoice_date] = [Invoice.due_date]` validates and saves when both fields are on the report.
- [x] Date-only fields appear in the formula insert list; text/boolean fields still do not.
- [x] Same calendar day → Yes on screen and in CSV/Excel; different days → No.
- [x] Missing date → blank cell (viewer dash / export blank), not No, and not a crash.
- [x] Format picker includes Yes/No; Number/Currency/Percentage still work for arithmetic formulas.
- [x] Existing `+ − × ÷` formulas are unchanged.

## How to test

1. Open Report Builder, Invoice report, include Invoice date and Due date.
2. Add a formula `[Invoice.invoice_date] = [Invoice.due_date]`, format Yes/No, save, run.
3. Check a row where both dates are the same day → Yes; a row where they differ → No.
4. Check a row with a missing due date → blank, not No.
5. Export CSV/Excel and confirm the same Yes/No/blank values.
6. Confirm an existing amount formula still calculates as before.
