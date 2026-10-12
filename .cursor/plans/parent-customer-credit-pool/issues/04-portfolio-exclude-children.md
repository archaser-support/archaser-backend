# 04 — Portfolio/CDP/reports exclude + attribute + sync on parent change

**Status:** done
<!-- completed 2026-09-30: descendant invoice attribution + today CTP/CDP sync; 2026-10-01: credit-dashboard detail report exclude/attribute + zero-limit KPI parity -->
**Priority:** normal
**Blocked by:** [01-inherit-lock-header](01-inherit-lock-header.md)
**User stories:** 20, 21, 29, 30, 31
**PRD:** `.cursor/plans/parent-customer-credit-pool.prd.md`

## Implementation note

**Shipped:** exclude customers with non-null `parent_customer_id` from Credit Portfolio Health, credit dashboard KPI **customer** cohorts, and **customer-grain** credit dashboard detail reports; Customers grid/search still list children.

**Invoice attribution:** attribute descendant invoices into root-pool CDP / Portfolio invoice-based KPIs **and** remap invoice-grain detail report rows (terms / reporting / reported) via `attributePrismaInvoiceCustomersToCreditPoolRoots` (leaves + ViewBased execute). Zero-limit summary KPI uses root `customer.count` (not mirrored child policy rows).

**Parent-change sync (D5″):** default `today_plus_async` — synchronous **today** CTP+CDP fail-closed with the parent save; scoped async CTP history job for earlier days; CDP chart history catches up overnight / Portfolio Health Generate (not a full history rewrite on the save path). No per-child CDP rows; child CTP continues with gap/at-risk zeroed.

## What was built

1. Exclude linked children as **customers** from Portfolio Health, CDP customer counts / limit-gap cohorts, and customer-grain credit dashboard reports.
2. For invoice-based CDP/Portfolio lines and invoice-grain detail reports, include descendant invoices and attribute displayed customer to the pool root.
3. Parent-change path: today CTP+CDP fail-closed; async scoped CTP history; `full_sync` only for tests.
4. Do not hide linked children from the main Customers grid or global search.

## Acceptance criteria

- [x] Credit Portfolio Health totals omit linked children as customers
- [x] Credit dashboard KPI customer cohorts omit linked children
- [x] Customer-grain credit dashboard reports omit linked children; invoice-grain rows show under pool root
- [x] Zero-limit (and similar) KPI cards count root customers only
- [x] Roots remain in those customer cohorts
- [x] Customers grid and search still list linked children
- [x] Invoice-based breach/exposure/AR CDP (and Portfolio) lines include descendant invoices under each root pool
- [x] Parent-link connect/disconnect/reparent syncs today CTP+CDP fail-closed and starts scoped async CTP history
- [x] Shell root with breached child invoices shows non-zero group breach on account CDP/Portfolio and under the root on terms/reporting grids

## How to test

1. Shell root + two linked children; children hold all AR and a reporting-breach invoice. After link, open Credit Portfolio Health / credit dashboard / terms report: root represents the pool; child invoices appear under the root; children are not separate overdue/zero-limit customers.
2. Change `parent_customer_id` on a child; confirm today CTP+CDP refresh with the save and a scoped history job starts; force a today CDP writer failure in a safe env and confirm the parent save fails closed.
3. Open Customers grid and search: both children still appear and open normally.
