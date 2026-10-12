# 03 — Header open AR: empty live set means zero

**Status:** done
**Priority:** normal
**Blocked by:** —
**User stories:** 1, 2, 11, 12, 19
**PRD:** `.cursor/plans/prevent-stale-overdue-rollups.prd.md`

## What to build

On the customer GET header open-AR path (`resolveCustomerHeaderOpenArAmounts` or equivalent), when the live Due/Overdue query returns **zero** open invoices, set due/overdue amounts and counts to **zero** (and keep total AR consistent with those cards).

Do **not** fall back to denormalized customer rollups (`number_of_overdue_invoices`, `total_overdue_amount`, etc.) when the live open set is empty. Denormalized fallback remains only when live computation cannot run (for example missing account currency) or another explicitly justified edge case documented in code — empty open set is not such a case.

Due and overdue header cards must stay consistent with total AR after the change so the three cards cannot disagree.

## Acceptance criteria

- [x] Live Due/Overdue count zero ⇒ header overdue/due amounts and counts are zero
- [x] Stale denormalized rollups (count/amount &gt; 0) are ignored when live open set is empty
- [x] Total AR / due / overdue header cards remain mutually consistent
- [x] Fallback to denormalized fields is not used solely because the open set is empty

## How to test

1. Find or seed a customer with all invoices Paid (or none Due/Overdue) but denormalized `number_of_overdue_invoices` / `total_overdue_amount` still &gt; 0.
2. Open customer overview: overdue card shows 0 / no “N invoices” secondary line; overdue list empty; due/total AR cards agree.
3. Customer with real overdue invoices still shows live amounts (regression).
