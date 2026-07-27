---
name: credit-only-no-automation-ux
overview: For credit-only accounts, suppress collection automation (no Automated category assignment or progression) and hide collection communication alerts on customer surfaces, while preserving credit-insurance banners and dual-product behavior.
source: grill-me session
clickup_task_url: null
isProject: false
---

# Credit-Only — No Automation & Hidden Communication Alerts

## Problem Statement

**Credit-only** accounts (`has_collection = false`, `has_credit_insurance = true`) are sold as a credit-insurance product, not a collections product. Despite existing UI restrictions elsewhere (navigation, permissions, General tab fields), customers on these accounts can still:

1. Be assigned the **Automated** collection category when overdue invoices trigger collection-period creation.
2. Progress through collection automation crons (activity generation, category transitions).
3. See **collection communication alerts** on the customer detail header (e.g. SMS blocked for country, stuck automation / no contacts).
4. See **Automated (n)** in the customers list Category column and use bulk/manual category change actions.

This creates a confusing experience: users see collection automation signals for a product that does not include collection workflows. Example: a UK customer on a credit-only account showing an **Automated** badge and an **SMS is blocked for this country** banner.

## Solution

For **credit-only accounts only**:

1. **Backend** — Do not create new open collection periods for their customers, and exclude their customers from collection automation crons even when legacy open periods exist in the database.
2. **Customer detail UI** — Hide the collection category chip; hide **communication** banners (SMS blocked, stuck automation); **keep** credit-insurance banners (overdue block, zero approved limit).
3. **Customers list UI** — Show blank/— in the Category column; hide bulk category update and manual category change on detail.
4. **No data migration** — Stale `Automated` values may remain in the DB; they are not shown or acted upon.

Dual-product accounts (`has_collection` + `has_credit_insurance`) and collection-only accounts are unchanged.

## User Stories

1. As a credit-only account user, I do not want new customers to enter the Automated collection category when invoices become overdue, so that collection automation does not run for a non-collection product.

2. As a credit-only account user, I do not want existing customers with legacy Automated periods to receive new automated activities, so that background crons do not send collection communications I did not purchase.

3. As a credit-only account user, I do not want to see an Automated category badge on the customer detail header, so that the UI reflects credit-only scope.

4. As a credit-only account user, I do not want to see SMS-blocked warnings on the customer page, so that I am not prompted to configure collection SMS for a product I do not use.

5. As a credit-only account user, I do not want to see stuck-automation / missing-contacts warnings on the customer page, so that collection workflow problems are not surfaced irrelevantly.

6. As a credit-only account user, I still want to see credit-insurance overdue-block (MEP) banners when applicable, so that credit risk signals remain visible.

7. As a credit-only account user, I still want to see zero-approved-limit policy banners when applicable, so that credit limit warnings remain visible.

8. As a credit-only account user, I do not want the customers list to show "Automated (1)" in the Category column, so that the grid does not imply active collection workflows.

9. As a credit-only account user, I do not want bulk "update category" actions on the customers list, so that I cannot accidentally manage collection categories.

10. As a credit-only account user, I do not want to open a manual category-change modal on customer detail, so that collection category management is unavailable.

11. As a dual-product account user, I want Automated category assignment and communication alerts to behave exactly as today, so that my collection workflows are unaffected.

12. As a collection-only account user, I want no change to category or alert behavior, so that regression risk is isolated to credit-only accounts.

13. As a developer maintaining crons, I want a single shared credit-only predicate reused across period creation and automation jobs, so that guards stay consistent as new entry points are added.

14. As a credit-only account user creating a new customer, I want category-for-new-collection to remain unset (existing behavior), so that defaults do not reintroduce Automated assignment.

15. As a credit-only account user with legacy open Automated periods in the database, I want the app to behave correctly without requiring a data cleanup, so that rollout does not depend on a migration script.

16. As a credit-only account user, I still want invoice overdue status and AR/credit KPIs to update when invoices become overdue, so that credit monitoring continues even when collection periods are not created.

17. As a credit-only account user, I do not want the Activities tab removed in this slice, so that historical activity records remain accessible if they exist.

18. As a credit-only account user, I accept that operation-dashboard automation metrics may still count legacy data until a future slice, so that this release stays focused on customer surfaces.

## Implementation Decisions

### Account product predicate (single seam)

- Introduce or consolidate a **shared server-side predicate** for credit-only accounts: `has_credit_insurance === true` AND `has_collection === false`.
- Mirror the existing client-side `isCreditOnlyAccount` pattern already used in navigation, permissions, customer detail, and new-customer forms.
- **All backend guards** for this feature must call this predicate — do not duplicate inline checks across crons and services.
- The predicate accepts account product flags (`has_collection`, `has_credit_insurance`) from `Account` (or equivalent DTO); callers resolve account context from the customer or collection period being processed.

### Backend — skip collection period creation

- **Collection period creation service** — When creating a **new** open collection period, if the customer's account is credit-only, **skip creation entirely** (no row, no Automated default). Updating an existing open period for outstanding amounts may still be needed for legacy rows; do not create new periods.
- **Overdue-invoice cron** — Continue overdue invoice status updates and customer activation; rely on the creation service guard (or pre-filter customer batch) so credit-only customers are not passed into new-period creation.
- **Other collection-period entry points** — Audit and guard any path that creates an open period with default category Automated (dispute handling, send-email flows, activity service fallbacks, API entity handlers). Credit-only customers must not get new open periods from any of these paths.
- **No schema changes** — Uses existing `Account.has_collection` and `Account.has_credit_insurance` flags.

### Backend — cron automation guards

- Exclude credit-only account customers from processing in:
  - Automated collection period processor (mark last step, prepare next activities, Agent transition phases).
  - Activity workflow manager (activity generation and send phases for Automated category).
  - Move collection to next category job.
- Guard pattern: filter at query time (`Customer.Account` product flags) or early-return per customer/period when account is credit-only.
- Legacy open periods with `current_category = Automated` remain in DB but receive **no new activities** and **no category transitions**.
- Do **not** set or refresh `automation_stuck_no_contacts` for credit-only customers as part of automation flows (if those flags are written in guarded crons, skip; if set elsewhere, evaluate whether skip is needed — prefer consistent exclusion from automation pipeline).

### Backend — manual category change

- Reject or no-op **manual category updates** (single customer and bulk) when the acting user's account is credit-only, with an appropriate error or silent skip consistent with API patterns for product-gated features.
- Permission layer may already restrict collection operations for credit-only; ensure category change APIs align.

### Backend — customers list category display

- When formatting customer list / report rows, if the row's account is credit-only, **omit category display** (null/blank) and **omit automation-stuck metadata** used for the warning icon on the Category column — even when DB still has `current_category = Automated`.
- Prefer server-side formatting in report execution / customer list data layer so all consumers of the view see consistent blanks.

### Frontend — customer detail header

- Derive `isCreditOnlyAccount` from account query (already available on customer detail parent) and pass to header.
- **Hide** the category metadata chip (label + divider segment) when credit-only.
- **Hide** SMS-blocked and stuck-automation notification banners when credit-only; skip or disable the SMS-blocking query when credit-only to avoid unnecessary API calls.
- **Keep** overdue-block and zero-approved-limit credit banners unchanged.
- **Disable** category-change affordance and modal when credit-only (`canChangeCollectionCategory` effectively false for credit-only).

### Frontend — customers list

- Resolve `isCreditOnlyAccount` from session account or account query (same pattern as layout / new customer).
- Hide **Mass update category** menu item when credit-only.
- Category column blanking is primarily server-driven; client column renderer should treat empty category as em dash without automation-stuck icon for credit-only rows if any client-side fallback exists.

### Architectural notes

- **Highest test seam**: the shared credit-only predicate applied at **collection period creation** — one unit test file extension proves the core "no new Automated periods" contract; cron guard tests prove legacy periods are not processed.
- **No translations** required unless new user-facing error copy is added for blocked category API; prefer reusing existing permission/product gating patterns without new strings.
- **No data migration** in this slice.

### Codebase scan (implementation touchpoints)

| Area | Action |
|------|--------|
| Shared account product predicate (new or existing util) | **Required** — single source of truth |
| Collection period creation service | **Required** — skip new periods for credit-only |
| Overdue invoice cron | **Required** — ensure credit-only excluded from new period creation |
| Dispute service period creation | **Required** — guard if it creates periods |
| Activity service period creation fallback | **Required** — guard |
| API entity handlers (send email, collection period create) | **Required** — guard Automated defaults |
| Customer service category update | **Required** — block manual/bulk for credit-only |
| Automated collection periods cron | **Required** — exclude credit-only |
| Activity workflow manager cron | **Required** — exclude credit-only |
| Move collection to next category cron | **Required** — exclude credit-only |
| Report execution / customer list row formatting | **Required** — blank category |
| Customer detail header component | **Required** — hide chip + comm banners |
| Customer detail parent (account flags to header) | **Required** — pass credit-only flag |
| Customers list component | **Required** — hide bulk category action |
| View column generator (category + stuck icon) | **Optional** — only if server blanking insufficient |
| New customer form (category null for credit-only) | **No change** — already implemented |
| Customer general info (collection fields hidden) | **No change** — already implemented |
| Permissions service / API | **Verify** — may already restrict collection ops |
| Operation dashboard cards | **Out of scope** |
| Control center no-contacts list | **Out of scope** |
| Activities tab on customer detail | **Out of scope** |
| Translation files | **No change** unless API error copy added |
| Prisma schema / migrations | **No change** |

## Testing Decisions

### What makes a good test

- Test **observable behavior** (period created or not, cron processes customer or not, formatted category value, banner rendered or not) — not internal call order.
- Use **account product flags** as inputs: credit-only vs collection-only vs dual-product control cases.
- Do not assert on specific Prisma query shapes unless necessary for regression on filter clauses.

### Primary seam (recommended)

**Collection period creation service** with credit-only account on customer — extend existing unit tests:

- Credit-only + overdue amounts + no open period → **no** `customerCollectionPeriod.create` call; result indicates skipped/no new period.
- Collection account control → period still created with Automated (or configured category).
- Dual-product control → period still created (unchanged).

This is the **highest single seam** for the "don't move to Automated" backend contract.

### Secondary seams

| Seam | Behavior under test | Prior art |
|------|---------------------|-----------|
| Automated collection periods cron | Credit-only customer with open Automated period → no activity marks / no next-activity prep | `processAutomatedCollectionPeriods.test.ts` |
| Activity workflow manager | Credit-only customer excluded from Automated generation query | Cron job unit/integration patterns in repo |
| Report row formatting | Credit-only row → category field null, no automation-stuck metadata | Report execution service tests if present |
| Customer header (optional) | Credit-only → no SMS/stuck banners; credit banners still render when data present | Customer dashboard view-model / component tests |

### Manual / staging test plan

1. Credit-only account, customer with overdue invoice → no new open collection period after overdue cron.
2. Legacy Automated period on credit-only customer → no new scheduled activities after workflow cron.
3. Customer detail → no category chip, no SMS/stuck banners; overdue-block banner still shows when `overdue_block` set.
4. Customers list → Category column blank; bulk update category action absent.
5. Dual-product account control → Automated category and SMS banner behavior unchanged.

## Out of Scope

- Dual-product accounts (`has_collection` and `has_credit_insurance` both true).
- Collection-only accounts (any change).
- Data backfill or closing legacy open collection periods on credit-only customers.
- Operation dashboard metrics (Missing Contacts, Automation Stuck, Undelivered Activities, etc.).
- Control center "customers without contact" list.
- Hiding the Activities tab on customer detail.
- Hiding or changing collection-related admin settings (activity sequences, templates).
- Billing connector or import flows.
- New ClickUp tasks or issue tracker entries (use `/to-issues` separately).

## Further Notes

### Testing seam confirmation

Implementation should centralize the credit-only predicate and test primarily at **collection period creation** (unit) plus **automation cron exclusion** (unit). UI changes are thin conditionals on the same flag; optional component tests if time permits. Confirm this matches expectations before coding.

### Related prior art

- New customer form already sets `category_for_new_collection` to `null` for credit-only accounts.
- Permissions API and service already filter collection permissions for credit-only accounts.
- Navigation sidebar hides collection entries for credit-only accounts.
- Customer General tab already hides collection-specific fields when `isCreditOnlyAccount`.

### Rollout

- Safe to deploy without migration; legacy DB state is masked and ignored by crons.
- Optional follow-up: operation-dashboard exclusion and/or data cleanup script to close stale open periods on credit-only accounts.

### Grill session decisions (locked)

| # | Decision |
|---|----------|
| 1 | Scope: credit-only accounts only |
| 2 | Backend + UI (not UI-only) |
| 3 | Skip period creation + cron guards |
| 4 | Hide SMS + stuck automation banners only; keep credit banners |
| 5 | Hide category on header + blank list column + disable category actions |
| 6 | No data migration |
| 7 | Customer surfaces only (not operation dashboard / Activities tab) |
