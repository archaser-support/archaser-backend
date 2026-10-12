# 03 — Mixed currencies and "Total: X" label

**Status:** done
**Priority:** normal
**Blocked by:** [01-builder-toggle-and-viewer-total-row](01-builder-toggle-and-viewer-total-row.md)
**User stories:** 10, 11, 13
**PRD:** `.cursor/plans/report-total-row.prd.md`

## What to build

Make the total row safe for money columns whose rows use different currencies, and finish the label rule. For each money column the server checks each row's currency. If all rows share one currency, the total is shown with that currency. If they differ, the server marks the cell as mixed currency with no value, and the viewer shows "—". COUNT columns never carry a currency. When every column in the report has an aggregation, there's no free column for the label, so the first cell reads "Total: X" (the label, then that column's value).

Build the per-row currency check as a shared helper. The [grouped-currency bug](https://app.clickup.com/t/869ffnakm) should reuse it for group rows.

## Acceptance criteria

- [x] A money column whose matching rows share one currency shows the total with that currency
- [x] A money column whose matching rows mix currencies shows "—" in the total row (no number)
- [x] Account-currency amount columns always total normally (they have one currency)
- [x] COUNT totals have no currency
- [x] When every column has an aggregation, the first cell shows "Total: X"
- [x] The currency check is one shared helper, not a copy inside the totals code
- [x] Matching English and Hebrew locale keys for any new copy (for example the "Total: X" pattern)

## How to test

1. In an account with customers in two currencies, build an Invoice report with the customer-currency amount (SUM) and the account-currency amount (SUM). Turn on Show total row.
2. Filter so the rows include both currencies. Expect "—" under the customer-currency amount and a normal total under the account-currency amount.
3. Filter to one customer (one currency). Expect the customer-currency total with that currency.
4. Build a report whose only columns are aggregated (for example Amount SUM and Invoice count COUNT). Expect the first cell to read "Total: …" with the Amount value.
5. Switch to Hebrew and repeat step 4: the label and value read right to left.
