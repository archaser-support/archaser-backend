---
name: parent-customer-credit-pool
overview: Shell parent roots own one credit policy pool; children inherit and lock policy and top-ups; parent Dashboard shows BU-scoped rollups; portfolio/CDP/credit-dashboard reports count the root (descendant invoices attributed); parent change syncs today CTP+CDP fail-closed and scopes async CTP history with a stepped progress modal.
source: grill-me session /start-work CU-869f9dx8q + grill 2026-09-30 shell-parent revision + 2026-10-01 report attribution + 2026-10-01 sync-progress modal grill + 2026-10-06 connect top-up remirror grill
clickup_task_url: https://app.clickup.com/t/869f9dx8q
isProject: false
---

# Parent customer shared credit policy pool

## Problem Statement

Credit insurance settings, approved limits, and capacity gaps live **per customer**. When a company hierarchy uses parent/child customers, credit officers must copy the same policy onto every child, can accidentally edit a child out of sync, and cannot see one shared limit against the whole group’s open AR (accounts receivable). Portfolio, credit dashboard KPI cards, and credit dashboard detail reports also double-count mirrored limits or list linked children separately if every linked child is summed or shown as its own cohort row.

## Solution

1. **Shell root + one shared pool** (nesting allowed): the credit-pool root (and every mid-level node with children) is a **shell** — no invoices and no payments. Group open AR vs one effective limit (root approved limit + root top-ups only). **Shared capacity gap and pool at-risk live on the root only** (linked children’s live capacity gap = 0; CTP history zeros capacity gap and at-risk on children).
2. **Inherit and lock:** On connect (any path that sets `parent_customer_id`), overwrite the child’s customer policy from the root (active **and** pending, including `customer_number_policy`) and keep mirroring while linked — **except capacity-gap snapshot fields, which stay 0 on children**. **Top-ups remirror the same way as policy (grill 2026-10-06):** cancel the child’s live top-up rows (`cancelled_at`), then copy every **uncancelled** root `CustomerTopUp` (past, current, and future windows) onto the child; empty root → cancel the child’s live top-ups with no new copies. Root top-up create/edit/cancel remirrors to all descendants. Shared extra cover still counts **root rows only** (child copies must not double the pool). Hide **Edit policy** and **Top-up** on linked children. On disconnect, unlock; **leave last mirrored policy**; **cancel all live top-ups** on the unbound customer (do not restore the pre-link rows; do not leave the last Group copies live). If that node still has descendants, remirror the subtree from it as the new root (those descendants end with no live top-ups either). Recalculate independently and **rebuild CustomerPolicyTrend history** as standalone.
2b. **CTP + CDP sync on parent change (fail-closed for live today; async CTP history):** On save, synchronously rewrite **today’s** CustomerPolicyTrend + Credit Dashboard Daily Snapshot (CDP) for affected pool members / account scopes and fail-closed with the parent save. Then start a **scoped async CTP history job** (pool members from earliest invoice/payment → today) that overlays root gap/at-risk; it does **not** rewrite full CDP chart history (overnight / Portfolio Health Generate catch up). Treat today’s membership as always-on for past CTP days. Root CTP: only capacity gap + at-risk become pool totals; other fields stay the root’s own as-of (plus breach OR roll-up — see §6). Children: capacity gap + at-risk = 0 on history; **keep writing child CTP** otherwise (no per-child CDP rows).
2c. **Progress modal during parent-change sync (grill 2026-10-01):** Open the credit-history refresh modal **immediately on Save** (not after the PUT returns). Keep sync **inside** the Save request (fail-closed). Extend the same `credit_pool_parent_history` job with a Save-time **`syncing`** phase and a `step` field the UI polls; then hand off to the existing async history phase (`running`). Modal shows a **checklist** of plain-language steps (remirror → capacity gap → today CTP → pool overlay → today CDP → breach/open-AR rollups → history). Bootstrap with “Starting…”. Modal is **not dismissible** while Save/syncing; on sync failure show failed step + error + Close (parent rolled back). After Save succeeds, history may keep today’s dismiss-while-running behavior.
3. **Parent Dashboard (not Aggregated Data for credit):** Shell parents show **Dashboard** with aggregated credit cards and a **member table** (local subtree ∩ business-unit permissions) plus claim counts. Linked children keep **N/A** on those pool cards. **Hide Invoices and Payments** tabs on any customer that has children. Keep **Aggregated Data** tab only when collection content exists; do not put the credit KPI block there.
4. **Header:** Child with a parent → parent name/link (portal metadata row). Parent with children → reciprocal **has child(ren)** indication (same header pattern).
5. **Portfolio / CDP / credit dashboard reports:** Exclude linked children as **customers** from Credit Portfolio Health, credit dashboard KPI **customer** cohorts, and **customer-grain** credit dashboard detail reports (overdue, capacity, limit warning, zero-limit, top-up, policy risk, no-policy exposure, period rankings). For invoice-based CDP/Portfolio lines **and invoice-grain detail reports** (terms, reporting, reported), **include descendant invoices** and **attribute the displayed customer to the pool root** so shell parents are not blind and KPI cards match the grid. Customers grid/search still list children.
6. **MEP / reporting breach roll-up:** If any pool member has MEP overdue-block or reporting/terms breach, **OR** that onto **every pool member’s** live `Customer.overdue_block` (parent + all siblings) and root CTP breach signals. Linked children show **pool-scoped** terms-breach KPIs on Dashboard/header (capacity gap / at-risk stay N/A on linked leaves). Recompute whenever any pool member’s insurance/breach fields change (and on parent-link change). Customer-grain overdue reports therefore list **roots only** (contagion alone must not surface linked children as separate overdue customers).

## User Stories

1. As a credit officer, I want a child’s policy settings to match the root parent when I link them, so that the hierarchy shares one credit posture.
2. As a credit officer, I want linked children’s policy fields locked, so that nobody edits a child out of sync with the root.
3. As a credit officer, I want Edit policy and Top-up hidden on a linked child, so that the UI makes the lock obvious.
4. As a credit officer, I want only the root’s top-up **rows** to raise the shared effective limit, so that copied child top-ups do not double-count the pool while linked.
5. As a credit officer, I want linking a child to copy the root’s uncancelled top-ups onto the child (after cancelling the child’s live top-ups), so that top-ups stay aligned the same way as customer policy.
5b. As a credit officer, I want later root top-up create/edit/cancel (including clearing all root top-ups) to remirror onto linked children, so that the pool does not drift.
6. As a credit officer, I want disconnect to unlock the child and keep the last mirrored **policy**, so that policy is not wiped when leaving the hierarchy.
6b. As a credit officer, I want disconnect to cancel the unbound customer’s **live top-ups** (and remirror that empty live set onto remaining descendants), so that Group copies and the child’s old top-ups do not stay live after unlink.
7. As a credit officer, I want the same inheritance rules when parent is set via import or ERP (Enterprise Resource Planning) sync, so that nightly links stay consistent with the UI.
8. As a credit officer, I want linking to succeed even if the root has no active policy yet, so that hierarchy setup is not blocked; children mirror empty until the root has a policy.
9. As a credit officer, I want root policy edits (including pending versions) to remirror to all descendants, so that the pool stays aligned.
10. As a credit officer, I want nested parents allowed, with one pool at the top root covering all descendants, so that multi-level company trees work — every node with children must be a shell.
11. As a credit officer, I want disconnecting a mid-level node to start a new pool under that node for its remaining descendants, so that partial unlinks are coherent.
12. As a credit officer, I want the **pool capacity gap on the root only** (children show 0 / N/A on pool cards), so that the group is not double-counted.
13. As a credit officer, I want invoice capacity gaps allocated with one oldest-first waterfall across the pool, but **persisted only on root invoices** (child invoice gaps = 0), so that gap has meaning only at the pool root.
14. As a credit officer, I want the **parent Dashboard** to show aggregated pool cards and a member table (not N/A), so that I can review the pool without using Aggregated Data for credit.
15. As a credit officer, I want Aggregated Data to remain available when collection content exists, so that dual-product accounts keep collection rollups.
16. As a credit officer, I want mid-level shell parents’ Dashboard cards and member table scoped to the **local subtree ∩ my business-unit permissions**, so that numbers match what I can see.
17. As a credit officer, I want open and total claim counts on the Dashboard member table, so that claim load is visible without changing claim create rules.
18. As a credit officer, I want claims still creatable on children, so that invoice-level claims stay with the correct customer.
19. As a credit officer, I want a parent link on the child header and a children indication on the parent header, so that I can navigate the hierarchy quickly.
20. As a credit analyst, I want linked children excluded as customers from Portfolio / CDP cohorts **and customer-grain credit dashboard detail reports**, with descendant invoices attributed under the root (including invoice-grain report rows), so that shell roots still show group breach and exposure without double-counting children.
21. As a credit analyst, I want children still listed in the main Customers grid and search, so that I can open them directly.
22. As a credit officer, I want English and Hebrew copy for new indications, locks, and Dashboard pool labels, so that both locales stay complete.
23. As a developer, I want a single connect/disconnect side-effect path for UI, API, and import, so that inheritance cannot drift by entry point.
24. As a product owner, I want deeper claim workflows beyond counts deferred, so that MVP (Minimum Viable Product) ships the shared pool first.
25. As a credit officer, I want parent link blocked if the would-be parent already has invoices or payments, so that only shell parents become roots.
26. As a credit officer, I want new invoices and payments blocked on any customer that has children, so that shell roots stay empty (greenfield; no grandfather path).
27. As a credit officer, I want Invoices and Payments tabs hidden on parents with children, while Dashboard and Policies stay, so that the shell is obvious in the UI.
28. As a credit analyst, I want MEP (Maximum Extension of Payment) / reporting breach on a child to mark the parent (and contagion across pool members), so that excluding children from cohorts does not hide group risk.
29. As a developer, I want parent_customer_id changes to fail-closed on live today CTP+CDP sync and to start scoped async CTP history for the AR window, so that dashboards update immediately without blocking the save on full history rewrite.
30. As a credit analyst, I want terms / reporting / reported detail grids to show child invoices under the **pool root** customer name/id, so that report record counts match CDP KPI cards.
31. As a credit analyst, I want zero-limit (and similar customer-grain) report KPI cards to count **root customers only**, not mirrored child policy rows, so that cards match the grid.

## Implementation Decisions

- **Pool membership:** Resolve **root** by walking `parent_customer_id` to the top. Group = root + all descendants (any depth). Credit inheritance / remirror side effects run when the account has credit insurance; **shell enforcement** (no invoices/payments on customers with children; block parent link if target has invoices/payments) applies **always** in this feature (collection UI/migration cleanup stays on the **same ClickUp task** — no new task).
- **Shell root:** Any customer with children must not have invoices or payments. Block setting `parent_customer_id` when the new parent already has invoices/payments. Block creating new invoices/payments on customers that have children. Greenfield — no grandfather/migration path in this PRD.
- **Canonical edits:** Only the top root may edit customer policy / top-ups for the pool. Linked customers (including mid-level shells that themselves have a parent) are locked for policy/top-up edits.
- **Mirror:** On connect and on root policy change, copy root active + pending customer-policy settings (including `customer_number_policy`) onto each descendant’s `CustomerPolicy` rows as needed. Capacity-gap snapshot fields on linked children forced to 0. Empty root policy → clear/empty mirrors.
- **Top-ups (connect remirror — grill 2026-10-06 D1–D8):** Same side-effect path as policy. On connect and on root top-up mutation: cancel descendant live top-ups, then insert copies of every **uncancelled** root row (all date windows; not cancelled history). Match/copy fields: insurance policy, start, end, type, amount, currency (plus notes/premium/audit as on the source). Empty root → cancel live descendant top-ups only. Shared effective limit = root `approved_limit` + **root** active top-ups only (ignore descendant copies in limit math). UI creates/edits hidden on linked children.
- **Disconnect:** Clear `parent_customer_id`; unlock UI; leave mirrored **policy** data; **cancel all live top-ups** on the unbound customer (leave cancelled history; do not uncancel pre-link rows; do not keep last Group copies live); if it has children, treat it as the new root and remirror policy + top-ups from that node (live top-ups empty); sync today CTP+CDP fail-closed and enqueue scoped async CTP history for affected roots.
- **Staging datafix (account 10149):** One-off lift of missing child top-ups **onto** empty shells is **not** this remirror. Plan: `.cursor/plans/lift-child-topups-to-shell-10149.plan.md` (copy cancelled history too; then cancel matching child rows; enqueue as-of rewrite).
- **Gap pipeline:** Group-scope capacity gap / invoice waterfall (combined open invoices oldest-first against shared effective limit). Persist gap on root only; child invoice gaps = 0.
- **Parent UI:** Hide Invoices + Payments tabs when `ChildCustomers` exist. Show Dashboard with pool rollup cards (replace N/A) + member table + claim counts. Linked children keep N/A on pool cards. Aggregated Data tab only if collection content exists.
- **UI scope (mid-level):** Dashboard cards and member table = **local subtree ∩ business-unit permissions**. Domain/CDP/Portfolio/credit reports still use the full top-root pool (with descendant-invoice attribution).
- **Header:** Parent link on children; has-child(ren) indication on parents.
- **Breach roll-up:** OR leaf MEP overdue-block / reporting / terms-breach onto **every** pool member’s live `Customer.overdue_block` and root CTP; recompute on any pool member insurance-field change and on parent-link change.
- **Portfolio / CDP / credit dashboard reports:** Skip linked children as customers (`parent_customer_id IS NULL` / `withExcludeLinkedChildCustomers` on credit dashboard customer scope). Attribute descendant invoices into root pool breach/exposure/AR lines. Invoice-grain ViewBased execute + leaves `get*Report` remap `customer_id` / Customer display to the pool root via `attributePrismaInvoiceCustomersToCreditPoolRoots`. Shell-root `customerId` drill-down expands to pool members (`resolveInvoiceReportCustomerIds`) on terms/reporting/reported. Zero-limit KPI counts **customers** (roots only), not mirrored child `CustomerPolicy` rows.
- **Parent-change history:** Default `today_plus_async` — synchronous today CTP+CDP (fail-closed); scoped async CTP history job for earlier days; no full CDP history rewrite on the save path.
- **Parent-change progress UI (D5‴):** Modal opens on Save; polls `credit_pool_parent_history` through `syncing` steps then `running` history; dismiss locked until Save finishes.
- **Child CDP:** No per-child CDP rows. Child CTP continues (gap/at-risk zeroed after pool overlay).
- **i18n:** All new user-facing strings EN + HE together.
- **Primary repo:** Backend for domain/API first; frontend on the same branch name when UI is touched.
- **Testing seam (preferred):** (1) parent-link + shell guards + mirror/lock, (2) group gap pipeline, (3) parent Dashboard rollup API/UI + BU scope, (4) portfolio/CDP/report exclusion + descendant invoice attribution + parent-change sync. Prefer existing customer-policy and gap-pipeline seams.

## Testing Decisions

- Prefer **external behavior**: after connect, child **policy and uncancelled top-ups** match root and edits are blocked; shell guards reject non-empty parents and new AR on parents; shared gap equals group AR vs root effective limit (root top-up rows only); parent Dashboard shows rollups (children N/A); parent breach reflects children; disconnect leaves last **policy**, cancels live **top-ups**, and unlocks; portfolio/CDP/customer-grain reports omit children as customers but include child invoices under root on invoice-grain reports; parent save refreshes today CTP+CDP together and starts async CTP history.
- Good tests assert outcomes (mirrored fields, gap amounts, exclusion counts, roll-up flags, report KPI card ≡ grid cohort), not internal SQL shape.
- Prior art: customer policy apply/save, gap sync pipeline, customer dashboard KPIs, portfolio health cohort filters, as-of CDP writers, credit dashboard ViewBased markers.
- Do **not** add automated tests unless the user explicitly asks in an implementation session.

## Out of Scope

- Separate “Policy dashboard” tab
- Credit KPI block on Aggregated Data (folded into Dashboard — D17)
- Hiding linked children from the main Customers grid or global search
- De-dupe of **generic report-builder / non–credit-dashboard** historical reports (credit dashboard detail reports **are in scope** — see §5 / stories 20, 30–31)
- Credit notification-rule contagion policy (alert every sibling vs root-only)
- Changing claim create/approve/pay workflows beyond Dashboard member claim counts
- Full collection Aggregated Data chart rewrite (tab remains when collection content exists)
- Collection shell-parent **UI/migration cleanup** — tracked on the **same existing ClickUp task** ([CU-869f9dx8q](https://app.clickup.com/t/869f9dx8q)); product rule is always-shell; this PR still enforces API/domain guards everywhere
- Virtual/is_virtual customer product type (shell = normal customer with no AR)

## Further Notes

### Grill decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | Shared limits/gaps | One pool |
| D2 | Canonical settings | Root-only edits |
| D3 | Connect existing child policy | Overwrite + mirror while linked |
| D4 | Top-ups + child UI | **Revised 2026-10-06:** remirror like policy (see D1t–D8t). Hide Edit policy & Top-up on children. Shared limit still root rows only. |
| D5 (orig) | Aggregated view | **Revised 2026-09-30:** fold credit into Dashboard (see D17′) |
| D6 | Child header gap | Children N/A on pool cards; parent shows rollup |
| D7 | Invoice gaps | One group waterfall (oldest first); persist on root only |
| D8 | Header parent link | Always when parent set; portal row = layout only |
| D9 | Nesting | Allowed; pool = top root + descendants; every non-leaf is shell |
| D10 | Aggregated credit MVP | **Revised:** Dashboard cards + member table |
| D11 | Mid-level UI | Local subtree ∩ BU permissions for cards/table |
| D13 | Parent has no policy | Allow link; mirror empty; remirror later |
| D14 | Import/ERP parent change | Same side effects as UI/API |
| D15/D16 | Portfolio double-count | Exclude linked children as customers; attribute descendant invoices |
| D17 | `customer_number_policy` | Mirror root’s number |
| D18 | Pending | Mirror active + pending; gaps use active until pending starts |
| D19/D20 | Claims | Allowed on children; counts on Dashboard member table |
| D1′ | Virtual customer type | Out of scope — keep real root + mirror |
| D2′ | CTP on parent link | Keep rewrite (root gap/at-risk; children zeroed) |
| D3′ | CDP pool breaches | Attribute descendant invoices to root |
| D3a′ | Shell AR | Parent has no invoices/payments |
| D3b′ | Parent header | Has-child(ren) indication |
| D3c′ | Parent vs child cards | Parent aggregated; children N/A |
| D4′ | Parent tabs | Dashboard + Policies; hide Invoices & Payments; Aggregated Data if collection |
| D5′ (orig) | CDP + Portfolio on parent change | **Revised 2026-10-01 (D5″):** live today only fail-closed with save |
| D5″ | Parent-change sync timing | Default `today_plus_async`: sync **today** CTP+CDP fail-closed; enqueue scoped async CTP history (earliest pool AR → today). CDP chart history catches up via overnight / Portfolio Health Generate. `full_sync` reserved for tests. |
| D5‴ | Parent-change progress UI | Open modal on Save; poll one `credit_pool_parent_history` job (`syncing` step checklist → `running` history). Sync stays in Save (fail-closed). Lock dismiss during sync; failed step + Close on rollback. |
| D6′ (orig) | CDP history range | **Revised:** save path no longer rewrites full CDP history (see D5″) |
| D7′ | Mark parent MEP/reporting | OR onto parent Customer + CTP |
| D7″ | Pool MEP contagion + child terms KPIs | Any leaf MEP sets `overdue_block` on **all** pool members (siblings + shells); new invoices stamp from that shared flag. Linked children show **pool** terms-breach KPIs (capacity/at-risk stay N/A). |
| D8′ | Roll-up timing | On any pool member insurance/breach change (+ link) |
| D9′ | Shell root | Enforce |
| D10′ | Link with existing AR | Block |
| D11′ | Shell scope (product) | Always; collection cleanup on same ClickUp task |
| D12′ | This PR | Enforce always now |
| D13′ | Legacy | Greenfield — no grandfather |
| D14′ | Nesting | Allowed |
| D15′ | Domain pool | Full top-root pool for CDP/Portfolio/credit reports |
| D16′ | Child CDP | No per-child CDP; keep child CTP (gap/at-risk 0) |
| D17′ | Aggregated Data (credit) | Fold into Dashboard |
| D18′ | Collection Aggregated Data | Keep tab only if collection content |
| D19′ | Member table | Local subtree ∩ BU permissions |
| D20′ | UI card scope | Same as table (local ∩ BU) |
| D21′ | Credit dashboard detail reports | Customer-grain: exclude linked children. Invoice-grain: include child invoices; attribute displayed customer to pool root (`attributePrismaInvoiceCustomersToCreditPoolRoots` on leaves + ViewBased execute). Zero-limit KPI = root `customer.count`. Shell-root `customerId` drill-down expands via `resolveInvoiceReportCustomerIds`. |
| D1t | Connect top-ups | Overwrite like policy — copy root uncancelled top-ups onto the child |
| D2t | Child’s old top-up rows | Cancel live rows (`cancelled_at`), then insert copies; keep cancelled history |
| D3t | Keep in sync | Root top-up create/edit/cancel remirrors to all linked descendants |
| D4t | Empty root top-ups | Cancel child’s live top-ups so they match empty |
| D5t | Disconnect top-ups | Cancel **all live** top-ups on the unbound customer (unlike policy, which keeps last copy) |
| D6t | Mid-level unlink | Remirror remaining descendants from the new root → they also have no live top-ups |
| D7t | Which root rows to copy | Every **uncancelled** root top-up (past, current, future). Not cancelled history |
| D8t | Shared limit while linked | Count **root** top-up rows only — child copies do not add extra cover |

### Discovery gates

| Gate | Notes | Blocks | Severity |
|------|-------|--------|----------|
| Customer dashboard KPI API for pool rollup | May extend existing customer dashboard KPIs / aggregated-data helpers for parent Dashboard | Slice 03 | Blocking |
| Open claim definition | Align with existing claim UI (non-terminal ≠ Paid/Rejected/Canceled) | Claim counts on Dashboard | Blocking |
| CDP writers accept pool membership + descendant invoices | Extend snapshot queries used by `takeCreditDashboardDailySnapshotsForAccount` | Slice 04 | Done (shipped) |
| Breach OR roll-up seam | Hook after `syncCustomerInsuranceFields` (or equivalent) to update pool members | Slice 01 | Blocking |
| Credit dashboard detail reports + ViewBased attribution | Leaves exclude/attribute; report-execution attributes `dashboard_credit_invoices` | Slice 04 | Done (shipped) |
| Collection shell UI/migration cleanup | Same ClickUp task CU-869f9dx8q — not a new task | Informational | Follow-up |

### Codebase scan

**Required**

- Customer `parent_customer_id` update paths (API mapper/service, import/billing connector parent resolution) + shell guards (`creditPoolShellGuards`)
- Invoice/payment create paths — block when customer has children
- CustomerPolicy apply/save + pending lifecycle; top-up list/create UI gating; `parentCustomerCreditInheritance` remirror **policy and uncancelled top-ups** on connect / root mutation / disconnect
- Gap pipeline (customer + invoice capacity gap sync) for group scope + root-only persist
- Customer header (parent + children indications); Policies tab lock/hide; hide Invoices/Payments tabs on parents
- Customer Dashboard cards/header N/A flip for parents; member table + claim counts; pool rollup helpers (`computeCreditPoolDashboardRollup`, `customerDashboardKpisService` pool expand)
- Aggregated Data: credit block removed / not shown; tab only when collection content
- `syncCreditPoolPolicyTrendsAfterParentChange` (`today_plus_async` default) + `creditPoolParentHistoryJob` + `runCreditPoolParentChangeSideEffects`
- Credit Portfolio Health / CDP cohort queries (`withExcludeLinkedChildCustomers`; descendant invoice attribution / `rollupCreditPoolOpenArToRoot` / `rollupCreditPoolBreachToRoot`)
- Credit dashboard detail reports: customer-grain exclude; invoice-grain `attributePrismaInvoiceCustomersToCreditPoolRoots` (leaves + `reports/.../report-execution.service`); zero-limit KPI root `customer.count`
- Parent MEP/reporting OR roll-up on live Customer + CTP (`computeOwnCustomerOverdueBlock` + contagion)
- EN + HE locale keys for new copy; FE credit-pool UI (`useCustomerCreditPool`, members card, history refresh dialog)

**Optional / out of scope unless requested**

- Full collection Aggregated Data chart rewrite
- Generic report-builder fields beyond credit-dashboard contexts
- Credit notification-rule contagion (alert every sibling vs root-only)
- Claim workflow changes
- `is_virtual` customer flag

**No change needed**

- `InsurancePolicy.parent_insurance_policy_id` (TopUp→Primary only — unrelated)
- Mongo sync double-run work (unrelated)
- Main Customers grid / global search (children remain listed)

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/parent-customer-credit-pool/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/parent-customer-credit-pool/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Shell guards, inherit/lock, header links, breach roll-up | `issues/01-inherit-lock-header.md` | — | 1–11, 5b, 6b, 19, 22–23, 25–28 |
| 2 | Shared group capacity gap + invoice waterfall | `issues/02-group-gap-waterfall.md` | 01 | 12–13 |
| 3 | Parent Dashboard rollups + member table (fold credit off Aggregated Data) | `issues/03-aggregated-data-credit.md` | 01 | 14–18, 22, 27 |
| 4 | Portfolio/CDP/reports exclude + attribute + parent-change sync | `issues/04-portfolio-exclude-children.md` | 01 | 20–21, 29–31 |

**Status (synced 2026-10-01 with OVERVIEW + shipped report work):** **01** `in-progress`; **02–04** `done` (04 includes credit-dashboard report exclude/attribute + `today_plus_async` parent-change sync).
