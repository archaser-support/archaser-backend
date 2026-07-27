---
name: top-up-usage-sticky-capacity-gap
overview: Correct credit-insurance dashboard usage KPIs when top-up is active (policy capped at 100%, overflow on top-up usage) and enforce sticky per-invoice capacity gaps so payments only adjust the paid invoice—not a customer-wide FIFO reshuffle.
source: grill-me session + Test Scenario.xlsx (customer 5404, limit 5000, 50% top-up)
clickup_task_url: null
isProject: false
---

## Problem Statement

Credit-insurance users managing customers with **top-up cover** and **invoice-level capacity gaps** see incorrect dashboard metrics and gap behavior after common operations:

1. **Policy usage exceeds 100% after top-up is added** — When open AR is above the base approved limit but within policy + top-up combined cover, the **Policy usage** card should cap at **100%** and show the slice above the policy limit on **Top-up usage**. Users currently see policy usage above 100% even though active top-up exists.

2. **Paying one invoice clears or reduces capacity gaps on other invoices** — Product rules require **sticky per-invoice gaps**: each open invoice keeps its `limit_assessed_amount` snapshot from when it became open; gap on an invoice is `max(0, that invoice's outstanding − limit_assessed_amount)`. Paying an invoice (especially via import or post-commit insurance sync) must recompute gap **only for the paid invoice(s)**. Users observe other invoices' gaps dropping incorrectly after a payment on a different invoice.

These issues undermine trust in the customer Dashboard tab (usage KPI cards, capacity gap, at-risk exposure) and in invoice-level gap visibility for collections and credit-insurance workflows.

## Solution

Deliver a consistent **credit-insurance gap and usage model** aligned with the product spreadsheet (Test Scenario.xlsx) and agreed grilling decisions:

- **Usage KPIs (when top-up is active on as-of date):**
  - **Policy usage** = consumption of base approved limit, **capped at 100%** when active top-up exists and AR exceeds the policy limit.
  - **Top-up usage** = `(AR − policy limit) / active top-up total`, capped at 100% of the top-up pool.
  - **Effective usage** = `AR / (policy limit + active top-up total)` — always combined cover; can be below 100% while policy is at 100% and top-up is partially used.

- **Sticky capacity gap:**
  - Per-invoice gap stored uncapped; **payments update only the invoice(s) that received payment**.
  - Adding top-up does **not** retroactively reduce existing invoice gaps.
  - Customer display / at-risk applies cap **after** summing invoice gaps: `min(gapSum, max(0, openAr − approvedLimit))` in account currency (base limit only; top-up does not shrink stored gaps).
  - New open invoices stamped once via **waterfall**: policy headroom first, then active top-up pool; if no headroom, `limit_assessed_amount = 0` and **that invoice's full outstanding** becomes its gap slice.

- **Operational fix:** Payment-only import and post-commit invoice change handlers must **not** re-run limit-assessment restamp across all open invoices (which reshuffles snapshots and clears other invoices' gaps). Gap sync must accept **scoped invoice IDs** for payment events.

## User Stories

1. As a **credit analyst**, I want policy usage to cap at 100% when an active top-up exists and AR exceeds the approved limit, so that I can see policy limit as fully utilized and overflow on the top-up card.

2. As a **credit analyst**, I want top-up usage to show the percentage of the top-up pool consumed above the policy limit, so that I know how much incremental cover remains.

3. As a **credit analyst**, I want effective usage to show total AR as a percentage of combined policy + active top-up cover, so that I have a single “overall cover utilization” metric.

4. As a **credit analyst**, I want policy usage to exceed 100% when no top-up is active, so that uninsured exposure above the policy limit is visible before top-up is added.

5. As a **credit analyst**, I want policy usage to stay above 100% and top-up usage at 0% when a top-up is recorded but **not yet active** (start date in the future), so that scheduled cover does not distort current metrics.

6. As a **credit analyst**, I want existing invoice capacity gaps to remain unchanged when I add or extend a top-up, so that historical uninsured exposure is not silently absorbed by new cover.

7. As a **collections user**, I want paying an invoice to reduce capacity gap only on that invoice, so that I can trust per-invoice gap columns in the invoice list.

8. As a **collections user**, I want paying a within-limit invoice (gap = 0) to leave other invoices' gaps unchanged, so that paying one bill does not clear another invoice's uninsured slice.

9. As a **collections user**, I want paying a gap invoice to reduce only that invoice's gap by the payment amount (via reduced outstanding), so that customer total gap drops by that invoice's contribution only.

10. As a **import operator**, I want payment-only invoice import updates to sync insurance gaps for the affected invoice only, so that batch payment files do not reshuffle gaps across the customer.

11. As a **import operator**, I want new invoice import to stamp `limit_assessed_amount` using policy-then-top-up waterfall, so that new exposure is assessed consistently with active top-up headroom.

12. As a **credit analyst**, I want the customer Dashboard tab capacity gap card to reflect the sum of invoice gaps with customer-level capping for display/at-risk, so that totals match business rules without per-invoice pre-capping before sum.

13. As a **credit analyst**, I want dashboard KPIs to refresh after top-up create/update, so that usage cards reflect the new active top-up without stale cache.

14. As a **credit analyst**, I want active top-up resolution to use calendar-day boundaries (start/end date inclusive), so that top-ups effective on the start date are included in usage metrics.

15. As a **developer**, I want pure functions for usage metrics (policy / top-up / effective) covered by unit tests mirroring spreadsheet rows, so that regressions are caught without database fixtures.

16. As a **developer**, I want the credit-insurance gap pipeline to remain the single orchestration entry (invoice gaps → policy aggregate → flags), so that all triggers behave consistently.

17. As a **credit analyst**, I want percentage top-ups (e.g. 50% of approved limit) to resolve to monetary top-up total in limit currency for usage KPIs, so that dashboard cards match manually calculated expectations.

18. As a **credit analyst**, I want top-up usage scoped to the customer's primary policy (parent policy link), so that unrelated top-up products on the account do not affect this customer's usage cards.

19. As a **collections user**, I want invoice status changes that affect outstanding to trigger scoped gap sync, so that marking paid or recording payment through any supported path behaves like sticky gap rules.

20. As a **product owner**, I want behavior documented against Test Scenario.xlsx (customer 5404, limit 5000, three × 2000 ILS invoices, 50% top-up, invoices 4–5, payment on invoice 3), so that QA can replay the scenario end-to-end.

21. As a **credit analyst**, I want health index and at-risk exposure to use capacity gap from stored invoice sums (with display cap), so that risk metrics stay consistent with agreed gap rules when top-up is present.

22. As a **developer**, I want restamp of open invoice limit assessment limited to events that add new open invoices (or explicit repair/backfill), not payment events, so that snapshot stickiness is preserved in production.

## Implementation Decisions

### Domain rules (authoritative)

| Topic | Rule |
|--------|------|
| Top-up added | Existing `capacity_gap_*` on invoices unchanged |
| Policy usage | Cap at **100%** only when top-up is **active** on as-of date; else `AR / limit` may exceed 100% |
| Top-up usage | `(AR − limit) / topUpTotal` when active top-up and AR > limit |
| Effective usage | `AR / (limit + topUpTotal)` when active top-up |
| Payment | Recompute gap **only** for invoice(s) that received payment |
| Customer gap display | Sum invoice gaps, then `min(gapSum, max(0, openAr − approvedLimit))` |
| New invoice at open | Waterfall stamp once; gap = that invoice's outstanding minus assessed |

### Testing seam (preferred)

**Single orchestration seam:** `syncCreditInsuranceGapPipelineForCustomer` with optional `invoiceIds` scope — all credit-insurance gap writes flow through this pipeline in order: invoice gap amounts → customer policy aggregate → `in_capacity_gap` flags.

**Pure metric seam:** `computeTopUpUsageMetrics` + `aggregatePolicyUsageFromRows` — spreadsheet-validated policy / top-up / effective percentages with no database.

Payment and import paths should **call the orchestrator** with scoped `invoiceIds` on payment-only events; **avoid** `restampCustomerOpenInvoiceLimitAssessment` on payment-only import (restamp remains for new open invoice batches and explicit repair scripts).

### Modules to build or modify

- **Gap pipeline orchestrator** — Accept scoped invoice IDs; preserve order invoice → policy → flags; no nested policy sync from flag module.

- **Invoice gap sync** — When `invoiceIds` provided, recompute and persist dual-currency gap only for those invoices; leave other open invoices' stored gaps untouched.

- **Customer policy gap aggregate** — Continue summing stored invoice gaps onto `CustomerPolicy`; apply customer-level cap for stored/display fields using open AR and base approved limit in account currency.

- **Invoice import service** — Distinguish new invoice creation vs payment-only updates on existing invoices; restamp limit assessment only when new open invoices were added for the customer; pass scoped invoice IDs to insurance sync on payment-only paths.

- **Invoice change post-commit effects** — Pass paid/changed invoice ID to customer insurance sync so full-customer gap recompute does not mask sticky behavior in edge paths.

- **Payment service** — Already passes `invoiceIds`; remain the reference pattern for manual payments.

- **Customer insurance sync** — Forward `invoiceIds` to gap pipeline on follow-up effects.

- **Effective approved limit / top-up resolver** — Active top-up query uses UTC calendar-day bounds consistent with `isActiveTopUp`; filter by parent primary policy where dashboard is policy-scoped; resolve percentage top-ups to monetary amount in limit currency.

- **Customer dashboard KPI service** — Build usage row inputs from open AR on policy in limit currency, base approved limit, and resolved active top-up total; aggregate policy/top-up/effective percentages; hard-cap displayed policy usage at 100% when any active top-up pool contributes to the aggregate.

- **Customer top-up service** — After create/update/cancel, trigger gap pipeline (no gap clear on existing invoices) and invalidate account dashboard cache so KPI queries refresh.

- **Entity API (invoice status update)** — Pass invoice ID scope into insurance sync after status changes.

### Architectural decisions

- **Sticky snapshot:** `limit_assessed_amount` is written once when an invoice becomes open (or on controlled restamp for new-import batches / backfill). It is **not** updated on payment, limit change, or top-up add.

- **Top-up vs gap separation:** Top-up affects usage KPIs and headroom for **new** invoices only; it does not retroactively absorb existing gap slices.

- **No FIFO reshuffle on payment:** Removed/impermissible: customer-wide restamp or FIFO gap reallocation when outstanding changes due to payment.

- **Scheduled top-up:** Until active by date range, treat as no top-up for usage KPIs (policy may exceed 100%).

### Schema changes

None required — uses existing `Invoice.limit_assessed_amount`, `capacity_gap_amount`, `capacity_gap_amount_limit`, `CustomerTopUp`, and `CustomerPolicy` gap fields.

### API contracts

- **Customer dashboard KPIs API** — Response cards continue to expose `policyUsagePct`, `topUpUsagePct`, `topUpTotal`, `effectiveLimit`, `effectiveUsagePct`; semantics per spreadsheet sheet 2 when top-up active.

- **Customer GET (credit insurance enrich)** — `has_active_top_up`, `top_up_total`, `effective_approved_limit` remain informational; dashboard tab relies on KPI endpoint for usage cards.

- **No breaking contract changes** — Correct behavior within existing fields.

## Testing Decisions

### What makes a good test

- Assert **externally visible behavior**: usage percentages, per-invoice gap amounts, customer gap sum — not internal call order or private helpers unless they are the designated pure metric seam.
- Use **spreadsheet fixtures** (Test Scenario.xlsx / `capacity-gap-excel-sheet1.json` top-up rows) as golden values for policy 100% + top-up 40% + effective 80% at AR 6000, limit 5000, top-up 2500.
- **Sticky gap tests:** Simulate invoice snapshots and outstanding changes; assert only the paid invoice's gap changes.
- **Import/payment tests:** Mock or integration-test that payment-only import does **not** invoke restamp; passes scoped invoice IDs to gap sync.

### Modules to test

| Module / seam | Test type |
|---------------|-----------|
| `computeTopUpUsageMetrics`, `aggregatePolicyUsageFromRows` | Unit — spreadsheet rows |
| Sticky gap contribution helper | Unit — pay non-gap invoice, pay gap invoice |
| `syncInvoiceCapacityGapAmountsForCustomer` with `invoiceIds` | Unit — findMany scoped; only listed invoices updated |
| `testScenarioTopUpPayment` (new) | Unit — end-to-end scenario from grilling |
| Payment service create payment | Unit — sync called with `invoiceIds` |
| Invoice import createMany (payment-only branch) | Unit — no restamp; scoped sync (if not already covered) |

### Prior art

- `tests/unit/creditInsurance/customerDashboardKpis.test.ts` — `aggregatePolicyUsageFromRows`
- `tests/unit/creditInsurance/invoiceCapacityGapExcelScenario.test.ts` — sticky payment scenarios
- `tests/unit/creditInsurance/invoiceCapacityGapScenario.test.ts` — limit change / payment totals
- `tests/unit/creditInsurance/syncInvoiceCapacityGapAmounts.test.ts` — invoiceIds scoping
- `tests/unit/creditInsurance/multiTopUpCapacityGap.test.ts` — waterfall stamping with top-up

### Manual QA (Test Scenario.xlsx)

1. Customer limit 5000; three open invoices 2000 ILS each → policy usage 120%, gap on third invoice only.
2. Add active 50% top-up → policy 100%, top-up 40%, effective 80%; invoice gaps unchanged.
3. Add invoices 4 (1000) and 5 (1000) with waterfall stamp.
4. Pay invoice 3 in full → AR 6000; only invoice 3 gap cleared; invoices 4–5 gaps unchanged; customer gap sum −1000 (before display cap).

## Out of Scope

- Changing uninsured amount bucket logic in legacy policy gap computation.
- Retroactive gap reduction when top-up is added (explicitly forbidden).
- FIFO or customer-wide gap reallocation on any event.
- New dashboard cards or UI layout changes beyond correct values in existing KPI cards.
- Translation file updates unless copy changes are requested separately.
- Portfolio credit dashboard chart rework (customer tab is in scope; portfolio may share metric helpers but full portfolio UX is follow-up).
- Multi-currency FX policy changes beyond existing invoice embedded rate for gap base/limit.
- Automatic restamp of all open invoices on limit **increase** (snapshots remain sticky per existing invoice-level gap plan).

## Further Notes

### Reference material

- **Test Scenario.xlsx** — Customer 5404, limit 5000 ILS, 50% top-up, invoices 21528767–21528771, payment on 21528769.
- **Related plans:** `.cursor/plans/invoice-capacity-gap-dual-currency.plan.md`, `.cursor/plans/credit-insurance-top-up.plan.md`, `.cursor/plans/invoice-level_capacity_gap_1cd83735.plan.md`.
- **Grilling session (2026-06-28):** All seven decisions confirmed (sticky gaps, scoped payment, scheduled top-up, customer cap after sum, waterfall stamp, per-invoice outstanding for gap slice, effective usage formula).

### Implementation status (conversation)

Initial fixes were applied in the same session: payment-only import skips restamp; post-commit sync passes `invoiceIds`; top-up resolver UTC day bounds; policy usage hard-cap when top-up pool present; dashboard cache invalidation on top-up save; unit tests in `testScenarioTopUpPayment.test.ts`. **`/to-issues`** should break remaining verification and any portfolio/chart alignment into vertical slices if not already done.

### Seams check (for `/to-issues` breakdown)

Recommended vertical slices:

1. **Pure metrics + KPI API** — spreadsheet parity for policy/top-up/effective usage.
2. **Sticky gap pipeline + payment/import scoping** — no restamp on payment; invoiceIds through orchestrator.
3. **Manual QA + regression** — replay Test Scenario.xlsx in staging.

If you expected a different seam (e.g. one UI-only slice), say so before running `/to-issues`.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp ARchaser list. **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Top-up usage & sticky capacity gap](https://app.clickup.com/t/869dwn85r)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Customer dashboard top-up usage KPIs | [869dwn881](https://app.clickup.com/t/869dwn881) | — | 1–5, 13–14, 17–18 |
| 2 | Sticky capacity gap on payment & import | [869dwn889](https://app.clickup.com/t/869dwn889) | — | 6–12, 19, 21–22 |
| 3 | Manual QA — Test Scenario.xlsx replay | [869dwn88k](https://app.clickup.com/t/869dwn88k) | 1, 2 | 20 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development. Tags: `ready-for-agent`, `enhancement`, `credit-insurance`.

