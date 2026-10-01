# 02 — Shared group capacity gap + invoice waterfall

**Status:** done (revised 2026-09-30 — root-only gap persistence; shell roots usually have AR = 0)
**Priority:** high
**Blocked by:** [01-inherit-lock-header](01-inherit-lock-header.md)
**User stories:** 12, 13
**PRD:** `.cursor/plans/parent-customer-credit-pool.prd.md`

## What to build

Extend the credit gap pipeline so a shared pool uses one effective limit (root approved limit + root top-ups only) against open AR of the root and all descendants. **Shell roots** normally contribute **0** AR (enforced in slice 01); math still includes root invoices if any exist from legacy paths. **Persist the shared capacity gap on the root only** (linked children store 0 / null). Run one oldest-first waterfall across the combined open invoices of the group for **ordering / limit assessed**, but **write invoice `capacity_gap_amount` only on root invoices** (child invoice gaps = 0). On disconnect (from slice 01), recalculate the unbound customer or new subtree independently.

No further product changes from the 2026-09-30 shell-parent grill beyond noting shell roots are empty of AR.

## Acceptance criteria

- [x] Group capacity gap = max(0, sum group open AR − shared effective limit) in the same currencies/rules as today’s per-customer gap
- [x] Root stores/displays the group capacity gap; linked children store **0** (not a copy of the group gap)
- [x] Invoice waterfall uses combined oldest-first order across root + descendants; gap amounts persist **only on root invoices**
- [x] After disconnect, gaps recalculate for the new solo/subtree pool without leftover group numbers

## How to test

1. Shell root limit 100,000; root AR 0; child A AR 60,000; child B AR 50,000. Expect shared capacity gap 10,000 on **root only**; children show 0 / N/A on pool cards.
2. Add a root top-up +20,000; shared gap drops accordingly; child top-ups do not change the pool while linked.
3. Open invoices across children with different dates; confirm waterfall order is group-wide but only root invoices carry non-zero `capacity_gap_amount` (typically all zero on root if shell has no invoices — confirm pipeline still stores group gap on root **CustomerPolicy** / CTP).
4. Disconnect one child; that child’s gap becomes its own AR vs its (left) limit; remaining group recalculates without that child’s AR.
