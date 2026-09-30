# 02 — Shared group capacity gap + invoice waterfall

**Status:** done
**Priority:** high
**Blocked by:** [01-inherit-lock-header](01-inherit-lock-header.md)
**User stories:** 12, 13
**PRD:** `.cursor/plans/parent-customer-credit-pool.prd.md`

## What to build

Extend the credit gap pipeline so a shared pool uses one effective limit (root approved limit + root top-ups only) against open AR of the root and all descendants. Persist the same shared capacity gap on root and linked descendants so headers match. Allocate invoice capacity gaps with one oldest-first waterfall across the combined open invoices of the group. On disconnect (from slice 01), recalculate the unbound customer or new subtree independently.

## Acceptance criteria

- [x] Group capacity gap = max(0, sum group open AR − shared effective limit) in the same currencies/rules as today’s per-customer gap
- [x] Every linked member’s stored/displayed capacity gap matches the group gap
- [x] Invoice capacity gaps use one combined oldest-first allocation across root + descendants
- [x] After disconnect, gaps recalculate for the new solo/subtree pool without leftover group numbers

## How to test

1. Root limit 100,000; parent AR 0; child A AR 60,000; child B AR 50,000. Expect shared capacity gap 10,000 on root and both children headers.
2. Add a root top-up +20,000; shared gap drops accordingly; child top-ups do not change the pool while linked.
3. Open invoices across parent and children with different dates; confirm invoice-level capacity gaps follow a single oldest-first pass against the shared limit.
4. Disconnect one child; that child’s gap becomes its own AR vs its (left) limit; remaining group recalculates without that child’s AR.
