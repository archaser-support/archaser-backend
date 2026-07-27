---
name: customers-total-due-amount-kpi
overview: Fix the Customers page summary KPI so Total Due Amount sums customer.total_due_amount (matching the grid column) instead of collection-period overdue outstanding, and rename the card label accordingly.
source: grill-me session
clickup_task_url: null
isProject: false
---

# Customers List — Total Due Amount KPI Fix

## Problem Statement

On the **Customers** page, the top summary card labeled **Total Amount** shows **0** even when individual rows in the grid display non-zero values in the **Total Due Amount** column (e.g. ~27,500 ILS across visible customers while the card reads ILS 0).

Users reasonably expect the summary card to reflect what they see in the table. Today it does not, because the card and the grid use different underlying data:

- The **KPI card** sums **overdue outstanding** from active **collection periods** (`CustomerCollectionPeriod.total_outstanding_amount` where `period_end_date` is null).
- The **grid column** shows each customer's denormalized **due** balance (`Customer.total_due_amount` — invoices that are due but not yet overdue).

When an account has due invoices but no overdue balances (as in the reported case: **Total Overdue Invoices** KPI and grid **Total Overdue** column both show 0), the summary card reads 0 while due amounts are visible row-by-row. This looks like a bug even though the overdue KPI is internally consistent.

## Solution

Align the summary monetary KPI with the grid:

1. **Change the KPI calculation** to sum `Customer.total_due_amount` for all customers in the user's access scope (same account, business-unit, and owner filters as today).
2. **Rename the card** from **Total Amount** to **Total Due Amount**, reusing the existing `fields.total_due_amount` translation key (no new translation entries required).
3. **Leave the Total Overdue Invoices KPI unchanged** — it continues to use collection-period overdue counts, which already matches the grid's overdue column in the reported scenario.

After the fix, a user viewing customers with due-but-not-overdue balances will see a non-zero **Total Due Amount** card that matches the sum of the grid column.

## User Stories

1. As a collections or credit user on the Customers page, I want the top **Total Due Amount** summary card to match the sum of the **Total Due Amount** grid column, so that I can trust the KPI without manually adding row values.

2. As a user whose customers have due invoices but zero overdue invoices, I want the summary card to show the combined due balance, so that the page does not misleadingly display ILS 0.

3. As a user reviewing customer exposure, I want the monetary KPI to reflect **due** balances (`total_due_amount`), so that it is semantically distinct from overdue collection-period outstanding.

4. As a user with access limited by business unit or owner assignment, I want the **Total Due Amount** KPI to include only customers I can see in the list, so that the summary respects the same access scope as today.

5. As a user viewing customers across both **Active** and **Inactive** collection statuses, I want inactive customers' due amounts included in the KPI total, so that the sum matches all rows visible under my access scope.

6. As a user with parent and child customer rows in the grid, I want the KPI to sum every row's `total_due_amount` as displayed, so that the card matches what I see without hidden deduplication logic.

7. As a user on an account denominated in a single base currency (e.g. ILS), I want due amounts summed as stored on the customer record, so that the KPI displays in the account's currency without conversion complexity.

8. As a user who also watches **Total Overdue Invoices**, I want that KPI to continue reflecting overdue invoice counts from collection periods, so that overdue metrics remain stable and consistent with the overdue grid column.

9. As a Hebrew-locale user, I want the renamed card to use the existing **Total Due Amount** translation, so that the label is correct in both EN and HE without new copy work.

10. As a user who does not change grid filters, I want account-level stats to load once on page open (unchanged behavior), so that performance and UX stay familiar.

11. As a developer maintaining the Customers stats API, I want the due-amount aggregation to use an efficient database sum (e.g. Prisma aggregate) rather than loading all customers with collection periods, so that the endpoint stays performant as customer count grows.

12. As a credit-only account user with due AR but no active collection workflows, I want the **Total Due Amount** KPI to still show meaningful totals, so that credit monitoring is not blocked by empty collection periods.

13. As a dual-product account user, I want the fix to apply uniformly regardless of product flags, so that customer list KPIs behave the same across account types.

14. As a user comparing **Active Customers** count to monetary totals, I want active/inactive counts to remain separate KPIs while due amounts include inactive customers, so that status breakdown and monetary exposure are both available.

15. As a user who exports or shares customer views, I want the on-page KPI to remain independent of the selected grid view/filter, so that summary stats stay account-scoped (not view-scoped) as they do today.

16. As a QA engineer, I want an automated test at the stats API boundary proving due amounts are summed correctly, so that a future refactor cannot reintroduce the collection-period mismatch.

17. As a user seeing **Last synced N days ago**, I understand that due amounts depend on customer denormalized fields and sync jobs, but I still expect the KPI to use the same field as the grid, so that card and table never disagree on definition.

18. As a product owner, I want the API response field name to reflect due amounts semantically, so that integrators and future UI do not confuse due totals with overdue outstanding.

## Implementation Decisions

### Primary test seam (single boundary)

- **Highest seam:** `GET /api/entities/customers?stats=true` — the customer list stats handler that returns `CustomerStats`.
- **Rationale:** One API boundary covers access-control filters, aggregation logic, and the contract consumed by `fetchCustomerStats` → `AccountStats`. No separate UI unit test is required if the API contract is verified; the UI only formats and labels the returned value.
- **Proposed test shape:** Unit test invoking the stats handler (or a thin extracted pure function for the sum) with mocked Prisma, seeding customers with mixed `total_due_amount` and collection-period overdue data, asserting `counts.total_due_amount` (or renamed field) equals the sum of `total_due_amount` and is independent of collection-period `total_outstanding_amount`.

### KPI data source change

- Replace the current loop that sums `CustomerCollectionPeriod.total_outstanding_amount` per customer with a **Prisma aggregate** (or equivalent) over `Customer.total_due_amount` using the **same `baseWhere` clause** already applied for customer counts (account, owner filter, business-unit filter).
- **Include** customers regardless of `collection_status` (active and inactive).
- **Do not** deduplicate parent/child rows — sum all customers matching `baseWhere`.
- **Currency:** Sum raw stored `total_due_amount` values (account base currency assumption); no multi-currency conversion in this slice.

### API response contract

- Rename the stats count field from `total_outstanding_amount` to **`total_due_amount`** in the `CustomerStats` type and JSON response, since the semantic meaning changes.
- Update the Customers page `AccountStats` consumer to read `counts.total_due_amount`.
- **`average_outstanding_per_customer`:** Recalculate as `total_due_amount / total_customers` (or rename to `average_due_per_customer` if clarity warrants — optional follow-up; minimum change is recalculating with the new numerator).
- **Unchanged fields:** `total_customers`, `active_customers`, `inactive_customers`, `total_overdue_invoices`, `currency`, `category_distribution`.

### UI label change

- In the Customers list summary cards component, change the monetary card label from `sections.total_amount` to **`fields.total_due_amount`** (existing i18n key in the customers namespace).
- No new translation file entries; do not modify locale JSON files.

### Access control (unchanged)

- Preserve existing logic: account from view-as context, owner filter for non-admin users, business-unit filter from `AccessControlService`.
- Stats remain **account-scoped**, not tied to the user's selected grid view, search, or report filter.

### Performance

- Prefer `_sum: { total_due_amount: true }` aggregate over `findMany` + include collection periods, since collection-period data is no longer needed for the due-amount KPI.
- Collection-period fetch may still be required for `total_overdue_invoices` unless that count is also moved to a customer-level aggregate in a future slice (out of scope here).

### Duplicate handler note

- Customer stats logic lives in the entities customers stats handler invoked by `?stats=true`. If a parallel copy exists elsewhere in the entities routing layer, **keep both in sync** or consolidate to a single implementation during implementation to avoid drift.

### Domain vocabulary

- **Total Due Amount** — denormalized open balance on `Customer` for invoices in **Due** status (`total_due_amount`).
- **Total Overdue / collection-period outstanding** — overdue balances tracked on open `CustomerCollectionPeriod` records; remains the source for the **Total Overdue Invoices** KPI only.

## Testing Decisions

### What makes a good test

- Assert **observable API output** (JSON counts returned to the client), not internal Prisma call shapes.
- Cover the **regression scenario**: customers with `total_due_amount > 0` and collection-period `total_outstanding_amount = 0` must yield a non-zero due total.
- Cover **scope**: customers outside `baseWhere` (different account, BU, or owner) must not contribute to the sum.
- Cover **inactive inclusion**: an inactive customer with due balance is included.
- Do **not** test React rendering of `AccountStats` unless a cheap snapshot is already standard — the API seam is sufficient.

### Modules to test

- Customer stats handler behind `GET /api/entities/customers?stats=true`.

### Prior art

- Handler-level API unit tests elsewhere in the repo (e.g. `tests/unit/update-last-payment-date.api.test.ts`, `tests/unit/reports/reportsApi.test.ts`) — mock Prisma/services, invoke handler, assert response body.
- No existing tests for customer stats were found; this slice adds the first.

## Out of Scope

- Fixing **Last synced N days ago** or collection-period / denormalized-field staleness (separate data-sync concern).
- Changing the **Total Overdue Invoices** KPI to use customer-level overdue fields instead of collection periods.
- Parent/child deduplication in the KPI sum.
- Multi-currency conversion when customers hold balances in mixed currencies.
- Making stats react to the active grid view, search, or report filter.
- Renaming or changing the grid **Total Due Amount** column (already correct).
- Adding `total_due_amount + total_overdue_amount` (total AR) as the KPI — explicitly not chosen; due-only per grill-me decision.
- Translation file edits (reuse existing keys only).
- ClickUp issue creation (use `/to-issues` separately).

## Further Notes

### Reported scenario (Mondeo LTD)

- Grid showed multiple rows with **Total Due Amount** values (e.g. 13,500 + 1,000 + 1,000 + 6,000 + 6,000 ≈ 27,500 ILS).
- **Total Overdue** column and **Total Overdue Invoices** KPI were 0 — consistent with collection-period overdue data.
- **Total Amount** card showed ILS 0 — inconsistent with the grid due column; root cause is field mismatch, not necessarily broken sync.

### Grill-me decisions (locked)

| Decision | Choice |
|----------|--------|
| KPI value | Sum `customer.total_due_amount` (match grid column) |
| Scope | All customers in user access scope (unchanged filters) |
| Label | **Total Due Amount** via `fields.total_due_amount` |
| Currency | Sum stored `total_due_amount` (account base currency) |
| Inactive customers | Include in sum |
| Parent/child | Sum all rows as shown (no dedup) |
| Overdue KPI | Leave unchanged |

### Follow-up (optional, not in this PRD)

- Align `average_outstanding_per_customer` naming with due semantics.
- Consolidate duplicate stats handler implementations if discovered during implementation.
- Consider a separate initiative if users want a **Total AR** (due + overdue) summary card in addition to due and overdue KPIs.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Customers list — Total Due Amount KPI matches grid | [869dyb7db](https://app.clickup.com/t/869dyb7db) | — | 1–7, 9–18 |

**Assignee / status:** Nilotpal Bose on all slices; **Selected for Development** per `.cursorrules`

**Related (non-blocking):** [bug - customer list - all data of overdue amount and due is not correct including currency](https://app.clickup.com/t/869c2nn87) (done — prior art)
