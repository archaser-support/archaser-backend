# 03 — Aggregated Data credit KPIs, members, claim counts

**Status:** done
**Priority:** normal
**Blocked by:** [01-inherit-lock-header](01-inherit-lock-header.md)
**User stories:** 14, 15, 16, 17, 18, 22
**PRD:** `.cursor/plans/parent-customer-credit-pool.prd.md`

## What to build

Reuse the existing Aggregated Data tab (any customer with children). Fix/extend the aggregated-data API so the UI receives a reliable member list plus, when credit insurance is on, shared credit KPIs (limit / effective limit / capacity gap / uninsured as applicable) and per-member + group claim counts (open non-terminal + total). Keep collection sections when collection is on. Mid-level parents see the tab; KPIs reflect the root pool. Claims remain creatable on children. EN + HE for new labels.

## Acceptance criteria

- [x] Aggregated Data API returns members + credit rollup fields needed by the UI (no silent empty contract mismatch)
- [x] Credit block shows shared KPIs and descendant table when credit insurance is on
- [x] Open + total claim counts appear per member and for the group (open = not Paid/Rejected/Canceled unless existing claim helpers define otherwise)
- [x] Collection content still available on dual-product accounts
- [x] English and Hebrew locale keys updated together

## How to test

1. Open a root with children on a dual-product account → Aggregated Data shows collection content and the new credit block.
2. Confirm shared KPIs match header/group gap from slice 02 when that is implemented (or match root limit and summed AR before slice 02 lands).
3. Create Draft and Paid claims on a child; table shows open and total counts for that member and the group.
4. Credit-only account with children: Aggregated Data still appears with the credit block.
5. Spot-check Hebrew labels on the credit section.
