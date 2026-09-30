# 01 — Connect/disconnect inherit + lock + header link

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 19, 22, 23
**PRD:** `.cursor/plans/parent-customer-credit-pool.prd.md`

## What to build

When credit insurance is on, any change to `parent_customer_id` (UI, API, import/ERP) runs the same connect/disconnect side effects: resolve the **root**, overwrite/mirror active + pending customer policy (including `customer_number_policy`) from root onto all descendants, remirror when the root’s policy changes, and on disconnect unlock while leaving last mirrored data (subtree under a disconnected mid-level node becomes a new pool). Nested parents are allowed; pool is always root + descendants. Linked children hide Edit policy and Top-up; only the root may edit. Child header shows a parent indication with a link on the portal metadata row (not gated on portal). Ship EN + HE for new copy.

## Acceptance criteria

- [x] Connect overwrites child policy from root and keeps mirrors in sync while linked (including empty root → empty mirrors)
- [x] Root policy updates (active + pending) remirror to all descendants
- [x] Disconnect unlocks and leaves last mirrored settings; mid-level disconnect forms a new root pool for remaining descendants
- [x] Import/ERP parent set/clear uses the same side-effect path as UI/API
- [x] Linked children hide Edit policy and Top-up; root top-ups only apply to shared effective-limit rules introduced here (gap math may land in slice 02)
- [x] Child header shows parent link whenever parent is set
- [x] English and Hebrew locale keys updated together

## How to test

1. On a credit account, set policy on root parent Acme; link child Store-A (UI). Confirm child’s Policies matches Acme, Edit policy and Top-up are hidden, header shows parent link.
2. Change Acme’s limit and add a pending change; refresh Store-A — mirrored active + pending match.
3. Link via import/`parent_customer_number`; same lock and mirror behavior.
4. Nest Counter-1 under Store-A; Counter-1 mirrors Acme (root). Disconnect Store-A from Acme; Store-A unlocks with last values; Counter-1 now follows Store-A as root.
5. Spot-check Hebrew labels for the parent indication.
