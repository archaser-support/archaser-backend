# 01 — Shell guards, inherit/lock, header links, breach roll-up

**Status:** in-progress
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 19, 22, 23, 25, 26, 27, 28
**PRD:** `.cursor/plans/parent-customer-credit-pool.prd.md`

## Implementation note (2026-09-30)

Backend inheritance + remirror is on `feat/parent-customer-credit-pool-CU-869f9dx8q`. Frontend lock/header UI was only local on another branch; moved to matching FE branch `feat/parent-customer-credit-pool-CU-869f9dx8q` (uncommitted). Mark **done** only after FE is committed and smoke-tested, **and** after the new shell / breach / tab items below land.

**CPT / gap (prior grill):** On `parent_customer_id` change, synchronously rewrite CustomerPolicyTrend for new+old roots (earliest CTP day → today), overlay pool capacity gap + at-risk on roots, zero those fields on children, fail/roll back the save on error. Live child capacity gap = 0; invoice gaps only on root. **CDP + Portfolio sync for the same range is slice 04** (must stay fail-closed with this save path).

**2026-09-30 grill additions:** shell-root enforcement (always); parent has-child(ren) header; hide Invoices/Payments on parents with children; MEP/reporting OR onto parent + recompute when any pool member’s insurance fields change.

## What to build

When credit insurance is on, any change to `parent_customer_id` (UI, API, import/ERP) runs the same connect/disconnect side effects: resolve the **top root**, overwrite/mirror active + pending customer policy (including `customer_number_policy`) from root onto all descendants, remirror when the root’s policy changes, and on disconnect unlock while leaving last mirrored data (subtree under a disconnected mid-level node becomes a new pool). Nested parents are allowed; every node with children must be a **shell**. Linked children hide Edit policy and Top-up; only the top root may edit pool policy/top-ups.

**Shell guards (always, greenfield):** Block setting a parent that already has invoices or payments. Block creating new invoices or payments on any customer that has children. Collection UI/migration cleanup stays on the same ClickUp task (CU-869f9dx8q); domain/API guards still apply now.

**Header / tabs:** Child header shows parent link (portal metadata row). Parent header shows has-child(ren) indication (same pattern). Hide Invoices and Payments tabs when the customer has children; keep Dashboard and Policies.

**Breach roll-up:** If any pool member has MEP overdue-block or reporting/terms breach, OR that onto **every pool member’s** live `Customer.overdue_block` (siblings + shells) and root CTP breach signals. Linked children show **pool** terms-breach Dashboard/header KPIs. Recompute whenever any pool member’s insurance/breach fields change, and on parent-link change.

Ship EN + HE for new copy.

## Acceptance criteria

- [x] Connect overwrites child policy from root and keeps mirrors in sync while linked (including empty root → empty mirrors) *(backend)*
- [x] Root policy updates (active + pending) remirror to all descendants *(backend)*
- [x] Disconnect unlocks and leaves last mirrored settings; mid-level disconnect forms a new root pool for remaining descendants *(backend)*
- [x] Import/ERP parent set/clear uses the same side-effect path as UI/API *(backend)*
- [ ] Linked children hide Edit policy and Top-up; root top-ups only apply to shared effective-limit rules *(FE present — smoke pending)*
- [ ] Child header shows parent link whenever parent is set *(FE present — smoke pending)*
- [x] Parent header shows has-child(ren) indication when children exist
- [x] Invoices and Payments tabs hidden on customers with children; Dashboard and Policies remain *(Invoices tab; no separate Payments tab on this screen)*
- [x] Parent link blocked when the would-be parent has invoices or payments (clear error)
- [x] New invoice/payment create blocked when the customer has children (API + UI paths)
- [x] Root `overdue_block` / CTP breach signals OR from any pool member; recomputed on member insurance-field change and on parent-link change
- [x] English and Hebrew locale keys updated together *(shell / children-header / validation)*

## How to test

1. On a credit account, create empty shell parent Group; set policy on Group; link child Store-A (UI). Confirm child’s Policies matches Group, Edit policy and Top-up are hidden, child header shows parent link, Group header shows children indication, Group has no Invoices/Payments tabs.
2. Try to set a customer that already has open invoices as parent → save fails with a clear error.
3. With Group linked to children, try to create an invoice on Group → blocked.
4. Put reporting breach / MEP overdue-block on Store-A → Group shows rolled-up breach; clear Store-A (with no other breached siblings) → Group clears.
5. Change Group’s limit and add a pending change; refresh Store-A — mirrored active + pending match.
6. Nest Counter-1 under Store-A (Store-A must be shell / no AR); Counter-1 mirrors Group (top root). Disconnect Store-A from Group; Store-A unlocks with last values; Counter-1 now follows Store-A as root.
7. Spot-check Hebrew labels for parent/children indications and shell errors.
