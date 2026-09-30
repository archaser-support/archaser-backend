---
name: parent-customer-credit-pool
overview: Parent/child customers share one credit policy pool (limits and gaps); children inherit and lock root settings; Aggregated Data shows credit rollups; portfolio totals count the root only.
source: grill-me session /start-work CU-869f9dx8q
clickup_task_url: https://app.clickup.com/t/869f9dx8q
isProject: false
---

# Parent customer shared credit policy pool

## Problem Statement

Credit insurance settings, approved limits, and capacity gaps live **per customer**. When a company hierarchy uses parent/child customers, credit officers must copy the same policy onto every child, can accidentally edit a child out of sync, and cannot see one shared limit against the whole group’s open AR (accounts receivable). Portfolio and dashboard totals also double-count mirrored limits if every linked child is summed separately.

## Solution

1. **One shared pool** under the **root** parent (nesting allowed): group open AR vs one effective limit (root approved limit + root top-ups only); the same shared capacity gap is shown on the root and all linked descendants.
2. **Inherit and lock:** On connect (any path that sets `parent_customer_id`), overwrite the child’s customer policy from the root (active **and** pending, including `customer_number_policy`) and keep mirroring while linked. Hide **Edit policy** and **Top-up** on linked children. On disconnect, unlock and **leave** the last mirrored data; recalculate that customer (or its new subtree pool) independently.
3. **Reuse Aggregated Data** (not a new tab): when the account has credit insurance, add shared credit KPIs, a member/descendant table, and open + total claim counts for the group.
4. **Header:** On any child with a parent, show a parent indication with a link on the same header row as the portal control (layout only — not gated on portal visibility).
5. **Portfolio:** Exclude linked children from Credit Portfolio Health and credit dashboard KPI totals so only the root represents the pool. Customers grid/search still list children.

## User Stories

1. As a credit officer, I want a child’s policy settings to match the root parent when I link them, so that the hierarchy shares one credit posture.
2. As a credit officer, I want linked children’s policy fields locked, so that nobody edits a child out of sync with the root.
3. As a credit officer, I want Edit policy and Top-up hidden on a linked child, so that the UI makes the lock obvious.
4. As a credit officer, I want only the root’s top-ups to raise the shared effective limit, so that child top-ups do not inflate the pool while linked.
5. As a credit officer, I want child top-up rows to stay in the database but not apply while linked, so that disconnect can restore prior child top-up behavior without data loss.
6. As a credit officer, I want disconnect to unlock the child and keep the last mirrored settings, so that the child is not wiped when leaving the hierarchy.
7. As a credit officer, I want the same inheritance rules when parent is set via import or ERP (Enterprise Resource Planning) sync, so that nightly links stay consistent with the UI.
8. As a credit officer, I want linking to succeed even if the root has no active policy yet, so that hierarchy setup is not blocked; children mirror empty until the root has a policy.
9. As a credit officer, I want root policy edits (including pending versions) to remirror to all descendants, so that the pool stays aligned.
10. As a credit officer, I want nested parents allowed, with one pool at the root covering all descendants, so that multi-level company trees work.
11. As a credit officer, I want disconnecting a mid-level node to start a new pool under that node for its remaining descendants, so that partial unlinks are coherent.
12. As a credit officer, I want one capacity gap for the whole group on every member’s header, so that child and parent KPIs do not disagree.
13. As a credit officer, I want invoice capacity gaps allocated in one oldest-first waterfall across root + descendants, so that shared coverage is fair across the group’s invoices.
14. As a credit officer, I want Aggregated Data to show shared credit KPIs and a member table when credit insurance is on, so that I can review the pool without a second tab.
15. As a credit officer, I want Aggregated Data to keep collection content when collection is on, so that dual-product accounts still have one parent rollup tab.
16. As a credit officer, I want any customer with children to see Aggregated Data, including mid-level parents, so that local trees are visible while KPIs still reflect the root pool.
17. As a credit officer, I want open and total claim counts per member and for the group on Aggregated Data, so that claim load is visible without changing claim create rules.
18. As a credit officer, I want claims still creatable on children, so that invoice-level claims stay with the correct customer.
19. As a credit officer, I want a parent link on the child header (portal row layout), so that I can jump to the root/parent quickly on credit-only accounts too.
20. As a credit analyst, I want linked children excluded from Credit Portfolio Health and credit dashboard KPI totals, so that shared limits and gaps are not double-counted.
21. As a credit analyst, I want children still listed in the main Customers grid and search, so that I can open them directly.
22. As a credit officer, I want English and Hebrew copy for new indications, locks, and Aggregated Data credit labels, so that both locales stay complete.
23. As a developer, I want a single connect/disconnect side-effect path for UI, API, and import, so that inheritance cannot drift by entry point.
24. As a product owner, I want deeper claim workflows beyond counts deferred, so that MVP (Minimum Viable Product) ships the shared pool first.

## Implementation Decisions

- **Pool membership:** Resolve **root** by walking `parent_customer_id` to the top. Group = root + all descendants (any depth). Credit inheritance side effects run only when the account has credit insurance.
- **Canonical edits:** Only the root may edit customer policy / top-ups. Linked customers (including mid-level parents that themselves have a parent) are locked.
- **Mirror:** On connect and on root policy change, copy root active + pending customer-policy settings (including `customer_number_policy`) onto each descendant’s `CustomerPolicy` rows as needed; store shared gap amounts on mirrors so headers match. Empty root policy → clear/empty mirrors.
- **Top-ups:** Shared effective limit = root `approved_limit` + root active top-ups only. Child top-ups ignored while linked; UI creates/edits hidden.
- **Disconnect:** Clear `parent_customer_id`; unlock UI; leave mirrored policy data; stop applying root top-ups rule; recalculate gaps for the unbound customer and, if it has children, treat it as the new root of its subtree (remirror that subtree from the new root).
- **Gap pipeline:** Extend capacity-gap / invoice-waterfall sync to group scope (combined open invoices oldest-first against shared effective limit). Prefer extending the existing credit-insurance gap pipeline seam over a parallel job.
- **Aggregated Data:** Reuse existing tab gated on having children. Fix/extend aggregated-data API so the UI receives members + credit KPIs + claim counts (open = non-terminal statuses not in Paid / Rejected / Canceled — confirm against existing claim UI helpers). Collection charts/sections remain when collection is enabled.
- **Header:** Parent name/link on the metadata row used for the portal icon; show whenever `parent_customer_id` is set.
- **Portfolio exclusion:** Credit Portfolio Health and credit dashboard KPI aggregations skip customers that have a non-null `parent_customer_id`. Root remains in totals with group-aware limit/gap where those KPIs read customer policy.
- **i18n:** All new user-facing strings EN + HE together.
- **Primary repo:** Backend for domain/API first; frontend on the same branch name when UI is touched.
- **Testing seam (preferred):** (1) parent-link side effects (mirror + lock flags / group membership), (2) group gap pipeline outcomes, (3) aggregated-data response shape, (4) portfolio/dashboard totals excluding linked children. Prefer existing customer-policy and gap-pipeline seams.

## Testing Decisions

- Prefer **external behavior**: after connect, child settings match root and edits are blocked; shared gap equals group AR vs root effective limit; disconnect leaves values and unlocks; Aggregated Data shows KPIs/members/claim counts; portfolio totals omit linked children.
- Good tests assert outcomes (mirrored fields, gap amounts, exclusion counts), not internal SQL shape.
- Prior art: customer policy apply/save, gap sync pipeline, Aggregated Data tab fetch, portfolio health cohort filters.
- Do **not** add automated tests unless the user explicitly asks in an implementation session.

## Out of Scope

- Separate “Policy dashboard” tab (D5 revised — reuse Aggregated Data)
- Hiding linked children from the main Customers grid or global search
- De-dupe of every historical report outside credit portfolio health + credit dashboard KPI totals
- Changing claim create/approve/pay workflows beyond Aggregated Data counts
- Reworking collection Aggregated Data charts beyond what is needed to ship the credit block and fix the API/UI contract
- Collection-only accounts changing credit tables (no credit side effects when credit insurance is off)

## Further Notes

### Grill decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | Shared limits/gaps | One pool |
| D2 | Canonical settings | Root-only edits |
| D3 | Connect existing child policy | Overwrite + mirror while linked |
| D4 | Top-ups + child UI | Root top-ups only; hide Edit policy & Top-up on children |
| D5/D12 | Aggregated view | Reuse Aggregated Data tab |
| D6 | Child header gap | Same shared group gap |
| D7 | Invoice gaps | One group waterfall (oldest first) |
| D8 | Header parent link | Always when parent set; portal row = layout only |
| D9 | Nesting | Allowed; pool = root + descendants |
| D10 | Aggregated credit MVP | Shared KPIs + member table |
| D11 | Who sees Aggregated Data | Any customer with children |
| D13 | Parent has no policy | Allow link; mirror empty; remirror later |
| D14 | Import/ERP parent change | Same side effects as UI/API |
| D15/D16 | Portfolio double-count | Exclude linked children from portfolio health + credit dashboard KPIs only |
| D17 | `customer_number_policy` | Mirror root’s number |
| D18 | Pending | Mirror active + pending; gaps use active until pending starts |
| D19/D20 | Claims | Allowed on children; Aggregated Data open + total counts |

### Discovery gates

| Gate | Notes | Blocks |
|------|-------|--------|
| Aggregated Data API ↔ UI contract | Today Nest returns simple sums; UI expects richer shape — fix/extend in the Aggregated Data slice | Credit block on Aggregated Data |
| Open claim definition | Align with existing claim UI (non-terminal ≠ Paid/Rejected/Canceled) | Claim counts |
| ChildCustomers / root helpers on customer load | Needed for tab visibility and header | Header + Aggregated Data |
| Nested root resolver | Shared by mirror, gaps, portfolio exclusion | Most slices |

### Codebase scan

**Required**

- Customer `parent_customer_id` update paths (API mapper/service, import/billing connector parent resolution)
- CustomerPolicy apply/save + pending lifecycle; top-up list/create UI gating
- Gap pipeline (customer + invoice capacity gap sync) for group scope
- Customer header (parent indication); Policies tab lock/hide actions
- CustomerAggregatedDataTab + `GET .../aggregated-data/:id`
- Credit Portfolio Health / credit dashboard KPI cohort queries (exclude linked children)
- EN + HE locale keys for new copy

**Optional / out of scope unless requested**

- Full collection Aggregated Data chart rewrite
- Report-builder parent fields beyond current parent name links
- Claim workflow changes

**No change needed**

- `InsurancePolicy.parent_insurance_policy_id` (TopUp→Primary only — unrelated)
- Mongo sync double-run work (unrelated)

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/parent-customer-credit-pool/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/parent-customer-credit-pool/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Connect/disconnect inherit + lock + header link | `issues/01-inherit-lock-header.md` | — | 1–11, 19, 22–23 |
| 2 | Shared group capacity gap + invoice waterfall | `issues/02-group-gap-waterfall.md` | 01 | 12–13 |
| 3 | Aggregated Data credit KPIs, members, claim counts | `issues/03-aggregated-data-credit.md` | 01 | 14–18, 22 |
| 4 | Portfolio/dashboard exclude linked children | `issues/04-portfolio-exclude-children.md` | 01 | 20–21 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
