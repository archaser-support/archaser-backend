# 03 — Parent Dashboard rollups + member table (fold credit off Aggregated Data)

**Status:** done
<!-- completed 2026-09-30: credit KPIs + member table on Dashboard; Aggregated Data collection-only -->
**Priority:** normal
**Blocked by:** [01-inherit-lock-header](01-inherit-lock-header.md)
**User stories:** 14, 15, 16, 17, 18, 22, 27
**PRD:** `.cursor/plans/parent-customer-credit-pool.prd.md`

## Implementation note (2026-09-30)

Backend Aggregated Data credit API was implemented under the old “credit on Aggregated Data” decision. **2026-09-30 grill (D17′/D18′):** fold credit KPIs + member table + claim counts onto the **parent Dashboard**; do **not** show the credit block on Aggregated Data. Keep Aggregated Data tab only when collection content exists. Reuse/adapt the existing rollup API for Dashboard if practical; otherwise add a customer-dashboard pool endpoint.

Mark **done** after FE shows parent Dashboard rollups (not N/A), children keep N/A, member table is local subtree ∩ BU permissions, and Aggregated Data no longer carries the credit block.

## What to build

On shell parents (customers with children):

- **Dashboard / header credit cards:** show aggregated pool KPIs (limit, effective limit, capacity gap, at-risk, breach-related cards as applicable) — **replace N/A**. Scope = **local subtree ∩ viewer business-unit permissions** (same scope as the member table).
- **Member table on Dashboard:** local children/descendants under this node (not necessarily the full top-root list on a mid-level), filtered by BU permissions; per-member + group open/total claim counts (open = non-terminal ≠ Paid/Rejected/Canceled unless existing helpers say otherwise).
- **Linked children:** keep **N/A** / not-available on those pool cards (pool lives on shells).
- **Aggregated Data:** remove/hide credit KPI block; show the tab only when collection content exists (dual-product). Credit-only shell parents rely on Dashboard only.
- Claims remain creatable on children. EN + HE for labels.

Domain/CDP still use the full top-root pool (slice 04); this slice is the **per-user parent UI**.

## Acceptance criteria

- [x] Parent Dashboard/header pool cards show aggregated values (not N/A) for customers with children
- [x] Linked children still show N/A on those pool cards
- [x] Member table on parent Dashboard lists local subtree ∩ BU permissions with open + total claim counts
- [x] Mid-level shell: cards and table use the same local∩BU scope (not an unfiltered full-tree leak)
- [x] Aggregated Data does not show the credit KPI block; tab appears only when collection content exists
- [x] Claims still creatable on children
- [x] English and Hebrew locale keys updated together

## How to test

1. Credit-only shell parent with two children → Dashboard shows rollup cards + member table; no Aggregated Data tab (or no credit block); no Invoices/Payments tabs (slice 01).
2. Dual-product shell parent → Aggregated Data still available for collection; credit KPIs live on Dashboard only.
3. Linked child → pool cards remain N/A; can open claims on the child.
4. Mid-level shell under a larger tree, user restricted to one business unit → cards and member rows only include permitted local members; totals match the visible rows.
5. Spot-check Hebrew labels on Dashboard pool cards and member table.
