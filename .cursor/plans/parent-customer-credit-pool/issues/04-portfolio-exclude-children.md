# 04 — Portfolio/dashboard exclude linked children

**Status:** done
**Priority:** normal
**Blocked by:** [01-inherit-lock-header](01-inherit-lock-header.md)
**User stories:** 20, 21
**PRD:** `.cursor/plans/parent-customer-credit-pool.prd.md`

## What to build

Exclude customers with a non-null `parent_customer_id` from Credit Portfolio Health and credit dashboard KPI totals so each shared pool is represented once by its root. Do not hide linked children from the main Customers grid or global search.

## Acceptance criteria

- [x] Credit Portfolio Health totals omit linked children
- [x] Credit dashboard KPI totals omit linked children
- [x] Roots remain in those totals
- [x] Customers grid and search still list linked children

## How to test

1. Create root + two linked children with mirrored limit 100,000 and shared gap 10,000.
2. Open Credit Portfolio Health / credit dashboard KPIs: totals behave as if only the root carries the pool (no 3× limit or 3× gap).
3. Open Customers grid and search: both children still appear and open normally.
