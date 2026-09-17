---
name: prevent-stale-overdue-rollups
overview: Keep customer overdue rollups aligned with Paid invoices after billing sync by failing loudly on balance refresh errors, fixing rollup module loading in the worker, and adding header plus reconciliation safety nets.
source: staging incident investigation (customer 21137 / SI260025412 virtual close; sync c61773a3)
isProject: false
clickup_task_url: https://app.clickup.com/t/869f3epee
---

# Prevent stale overdue rollups after billing sync

## Problem Statement

After billing sync (especially account 10149 reconciled virtual closes), invoices can be correctly stamped **Paid** while the customer’s denormalized overdue fields (`number_of_overdue_invoices`, `total_overdue_amount`, and related due/overdue buckets) stay at pre-payment values.

Operators and collectors then see an overview card that still shows overdue amount and invoice count, but the overdue invoices list is empty. The sync history can still show **SUCCESS**, so the failure is easy to miss.

Staging evidence (2026-09-17 incremental run): pending closes and invoice Paid updates succeeded; the `_balances` step failed because the worker could not load `recalculateCustomerAmounts` (`Cannot find module .../recalculateCustomerAmounts.js`). Errors were swallowed; overall status remained SUCCESS. Of 25 customers touched in that virtual-close second, 21 remained fully stale (rollup overdue count greater than zero with zero live Overdue invoices).

The customer overview amplifies the bug: when live Due/Overdue invoice count is zero, header open AR falls back to those stale denormalized rollups instead of treating open AR as zero.

## Solution

Prevent recurrence with three complementary layers:

1. **Honest sync outcome** — If customer balance / rollup refresh fails after invoices or virtual closes changed Paid state, the connector sync execution must not complete as SUCCESS. Operators see FAILED or PARTIAL, with the balances error retained in entity stats and alerts.
2. **Reliable rollup refresh in the worker** — Loading `recalculateCustomerAmounts` must not depend on a fragile relative path that breaks in the deployed workspace layout. Prefer a hard dependency or an injected host callback; add a boot-time check so the worker refuses sync work if rollup refresh cannot load.
3. **Safety nets** — (a) Customer overview header: when live Due/Overdue set is empty, show zero overdue/due rather than stale denormalized rollups. (b) A reconciliation job that finds customers whose overdue rollup disagrees with live Overdue invoices and recalculates them. (c) One-time repair for the known Sep 17 virtual-close stale cohort on staging (and any production equivalent if present).

Together: sync tells the truth, rollups can always run, and even a future miss does not show fake overdue on the customer page for long.

## User Stories

1. As a collector, I want the overdue amount card to match live overdue invoices, so that I do not chase paid customers.
2. As a collector, I want an empty overdue list when there is no overdue balance, so that the UI does not contradict itself.
3. As an AR operations lead, I want sync runs that fail balance refresh to show as failed or partial, so that I know customer totals may be wrong.
4. As an AR operations lead, I want the balances error message visible on the sync execution, so that I can diagnose path or deploy issues quickly.
5. As an on-call engineer, I want an alert when `_balances` fails, so that I do not discover the issue only from a customer ticket.
6. As a platform engineer, I want the worker to load rollup refresh reliably in staging and production layouts, so that virtual closes always update customer overdue fields.
7. As a platform engineer, I want a boot check that rollup refresh can be required, so that a bad image fails before it marks thousands of invoices Paid without rollups.
8. As a platform engineer, I want `CUSTOMERS_DOMAIN_ROOT` (or a shared package) documented for deploy, so that path layout changes do not silently break sync.
9. As a billing connector owner, I want virtual closes and cash payments to share the same post-Paid rollup guarantee, so that 10149 reconciled closes cannot diverge from normal payment import.
10. As a billing connector owner, I want cancelled or partial syncs that already stamped Paid to still attempt rollup refresh or leave a non-success status, so that mid-run stops do not leave stale headers.
11. As a product engineer, I want customer GET header open AR to trust an empty live Due/Overdue set as zero, so that Paid-only customers never show stale overdue from denormalized fields.
12. As a product engineer, I want due and overdue header cards to stay consistent with total AR after the header change, so that the three cards cannot disagree.
13. As a credit insurance user, I want overdue block / days-overdue displays to remain coherent after rollups catch up, so that insurance signals are not driven by stale counts longer than necessary.
14. As an ops engineer, I want a reconciliation cron that finds rollup vs live Overdue mismatches, so that historical gaps self-heal without manual scripts.
15. As an ops engineer, I want reconciliation to call the same `recalculateCustomerAmounts` path as sync, so that repair logic does not fork.
16. As an account admin, I want a way to re-run rollups for one customer (existing scripts or admin action), so that I can unblock a single ticket without waiting for the cron.
17. As a staging QA engineer, I want the Sep 17 stale cohort repaired after the fix ships, so that known bad customers look correct before retest.
18. As a developer, I want tests that a balances failure cannot yield SUCCESS, so that the silent-success regression cannot return.
19. As a developer, I want tests that empty live Due/Overdue yields zero header overdue, so that the stale fallback regression cannot return.
20. As a developer, I want tests or a boot assertion that rollup module resolution succeeds for the worker layout, so that deploy path bugs fail CI or startup.
21. As a support agent, I want sync history to show pending closes done and balances failed distinctly, so that I can explain “invoices paid, totals not refreshed” to the customer.
22. As a finance ops user, I want incremental sync that only touches other customers not to be blamed for unrelated stale customers, so that triage stays scoped to affected cohorts.
23. As a release manager, I want production deploy of the worker to include the api customers domain artifact (or shared package) the host expects, so that SUCCESS means rollups actually ran.
24. As a security-conscious admin, I want repair jobs to avoid logging secrets or full connection strings, so that ops scripts stay safe.
25. As a future maintainer, I want this failure mode documented near sync completion rules, so that “swallow balances errors” is not reintroduced for convenience.

## Implementation Decisions

- **Scope of this PRD** is prevention layers 1–3 from the incident review: honest sync status, reliable rollup loading, header + reconciliation safety nets, plus cohort repair. No redesign of virtual-close business rules themselves.
- **Sync completion status:** When the `_balances` (customer due/overdue rollup) step ends in `failed`, the connector sync execution terminal status must not be `SUCCESS`. Prefer `FAILED` if balances were required for the run’s affected customers; `PARTIAL` is acceptable only if the product already uses that status for mixed outcomes and UI/alerts treat it as non-green. Entity stats must keep `sample_errors` / error text.
- **Do not swallow balances failure as a soft log-only event** on the happy path that still completes SUCCESS. Recording stats then failing the run is required.
- **Rollup load strategy (choose in implementation, prefer durability):**
  - Best: extract or depend on a shared module the worker already ships, and call it with a normal import (no `__dirname` walk to `api/dist`).
  - Acceptable short-term: inject `onCustomerBalancesFinal` from the worker/Nest host that imports the compiled customers domain directly, and keep the dynamic host only as fallback.
  - Always: support `CUSTOMERS_DOMAIN_ROOT` override; resolve multiple known workspace layouts; **throw** if none load.
- **Worker boot check:** On worker startup (or first sync accept), verify rollup refresh can load. Fail fast with a clear error rather than running Payment / pending closes first.
- **Deploy contract:** Staging/production images must include whatever artifact the chosen load strategy needs (shared package or `api/dist/customers/...`). Document in worker/billing-connector runbook notes.
- **Header open AR:** In `resolveCustomerHeaderOpenArAmounts` (or equivalent customer GET header path), when the live Due/Overdue query returns **zero** open invoices, set due/overdue amounts and counts to **zero** (and consistent total AR). Do **not** fall back to denormalized customer rollups in that case. Denormalized fallback remains only when live computation cannot run (for example missing account currency) or an explicitly justified edge case documented in code comments — empty open set is not such a case.
- **Reconciliation job:** Periodic (or existing cron family) scan: customers with `number_of_overdue_invoices > 0` (or due rollup mismatch) where live Overdue (or Due) counts disagree; call `recalculateCustomerAmounts` for those ids. Bound batch size; respect frozen accounts if that guard exists for sibling crons.
- **One-time repair:** Script or ops run to recalculate the known virtual-close cohort (and optionally all fully stale customers account-wide) on staging after deploy; same for production if metrics show the same pattern.
- **Observability:** Existing sync entity_stats `_balances` key remains the source of truth for UI; ensure non-SUCCESS emits the same observability path as other sync failures.
- **No Prisma schema change** required for the core fix. Reconciliation may reuse CronJob registry patterns already used for collection crons.
- **Account 10149:** Virtual close path already returns `customerIds` into the finalize set when flush succeeds; this PRD does not change close semantics — it ensures finalize failure is visible and loadable.

## Testing Decisions

**What makes a good test:** Assert external behavior — sync terminal status, header fields on customer GET, and rollup numbers after Paid — not private path string details (except a dedicated resolution/boot test).

**Primary seam (preferred, highest):** Billing connector sync completion / lifecycle around `finalizeCustomerBalances` (or the function that maps entity_stats `_balances` into execution status). Drive a run where balances callback throws; expect terminal status not SUCCESS and error retained on `_balances`.

**Secondary seam:** `resolveCustomerHeaderOpenArAmounts` (credit-insurance-domain / customer header open AR). Given denormalized overdue count/amount greater than zero and live invoice list empty (or only Paid), expect returned overdue count/amount zero.

**Tertiary seam:** Rollup host loader — given missing module path, throws; given valid root / injected callback, recalculate is invoked. Prefer testing through the public `recalculateCustomerAmountsViaHost` / injected callback contract.

**Prior art:**
- Customer GET header open AR tests (`customers-get-by-id-total-ar` style).
- Billing connector sync history / entity_stats tests.
- Cron freeze and handler tests that assert job outcomes when a step fails.

**Manual / staging How to test:**
1. After deploy, open sync history for account 10149; confirm a forced balances failure (or staging replay) shows non-SUCCESS with `_balances` error.
2. On a customer with all invoices Paid and previously stale rollups, open customer overview: overdue card shows 0 / no “1 invoice” secondary line; overdue list empty and consistent.
3. Run reconciliation or one-customer recalc; confirm `number_of_overdue_invoices` and `total_overdue_amount` match live Overdue count/sum.
4. Regression: complete incremental sync with healthy balances; SUCCESS still allowed when `_balances` is done.

## Out of Scope

- Changing which ERP rows become virtual closes or 10149 payment-drop rules.
- Redesigning collection period open/close workflows beyond refreshing amounts already written by `recalculateCustomerAmounts`.
- Reworking credit-insurance as-of / snapshot math (separate domain rules).
- Making every sync step transactional with Paid + rollups in one DB transaction (eventual consistency with honest status is enough for this PRD).
- Full historical backfill of all accounts beyond the reconciliation job and the known incident cohort.
- UI redesign of the overdue cards beyond correct values.
- ClickUp / process changes.

## Further Notes

- Incident anchor: staging Mongo `connector_sync_executions` id `c61773a3-e6dc-46b8-9a25-90ce713cd23a` (2026-09-17); virtual payment `virtual|SI260025412` for customer 21137; invoice SI260025412 Paid with zero outstanding while customer rollups stayed at 1 / 3528.
- Architecture reminder: invoice Paid is written by payment/link recalc; customer overdue rollups are a **separate** finalize step. Any future “soft fail” on finalize reopens this incident class.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/prevent-stale-overdue-rollups/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/prevent-stale-overdue-rollups/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Reliable rollup host load + boot check | `issues/01-reliable-rollup-host-load.md` | — | 6, 7, 8, 9, 20, 23 |
| 2 | Honest sync status when balances fail | `issues/02-honest-balances-sync-status.md` | 01 | 3, 4, 5, 10, 18, 21, 25 |
| 3 | Header open AR: empty live set means zero | `issues/03-header-empty-open-ar-zero.md` | — | 1, 2, 11, 12, 19 |
| 4 | Stale rollup reconciliation + cohort repair | `issues/04-stale-rollup-reconciliation.md` | 01 | 14, 15, 16, 17, 22, 24 |

**Status:** `ready-for-agent` on all slices.
