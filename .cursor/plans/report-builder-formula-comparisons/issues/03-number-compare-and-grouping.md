# 03 — Number compares, mixed math, grouping

**Status:** done
**Priority:** normal
**Blocked by:** [02-date-compare-language](02-date-compare-language.md)
**User stories:** 20–23, 31–35
**PRD:** `.cursor/plans/report-builder-formula-comparisons.prd.md`

## What to build

Allow the same compare symbols on **numbers**, and allow mixing a compare with arithmetic in one expression.

Number compares use the same decimals as formula math. Both sides of a compare must be the same family (date-like vs numeric); `[Invoice.invoice_date] = 1` is rejected. After a compare yields 1/0, math on that number is allowed, e.g. `([Invoice.invoice_date] = [Invoice.due_date]) * [Invoice.amount]`. Other formulas can reference a Yes/No column as 1/0.

Compare binds looser than `+ − × ÷`; mixing needs parentheses. On grouped reports, SUM/AVG/MIN/MAX of 1/0 shows a **number** even if format is Yes/No. Text/boolean/list compares stay blocked.

## Acceptance criteria

- [x] `[Invoice.amount] > 1000` and amount-to-amount `=` work with decimal exactness.
- [x] `(date = date) * amount` works; without parentheses, `date = date * amount` is invalid (type/family error).
- [x] A second formula can use `[Dates match] * [Invoice.amount]` via formula chaining (raw 1/0).
- [x] Date vs number compares are rejected on save.
- [x] Text/boolean/list fields still cannot be compare operands.
- [x] Grouped report: formula aggregation SUM/AVG/MIN/MAX of a Yes/No compare shows a number (e.g. count of matches), not Yes.

## How to test

1. Add `[Invoice.amount] > 1000`, format Yes/No, run on amounts above and below 1000.
2. Add `([Invoice.invoice_date] = [Invoice.due_date]) * [Invoice.amount]`, format Currency — matching rows show amount, non-matching show 0 (or blank only if an operand is missing).
3. Add a Yes/No compare formula, then a second formula that multiplies it by amount — results match the mixed formula.
4. Try `[Invoice.invoice_date] = 1` and a text-field compare — save is blocked.
5. Group the report by customer, set the compare formula aggregation to SUM — the group cell is a number (how many matching invoices), not Yes/No.
