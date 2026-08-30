---
name: import-ar-post-ingest-refresh
overview: After connector and file invoice/payment ingest, run chronological AR replay, Process Overdue Invoices for touched customers (all accounts), then live MEP and capacity-gap refresh (and enqueue as-of rewrite) so overdue status and credit cards are correct without waiting for the daily cron.
source: grill-me sessions (post-import MEP & capacity gap; post-import Process Overdue Invoices)
clickup_task_url: null
isProject: false
---

# Import AR post-ingest refresh (MEP, capacity gap & overdue status)

## Problem Statement

Credit insurance live metrics — customer MEP (Maximum Extension Period) overdue block and capacity gap — depend on chronological accounts receivable (AR) replay (to stamp assessed limits) and a live refresh pipeline afterward.

Invoice and payment ingest save past-due open invoices as **Due**. They do not flip them to **Overdue**. That flip is owned by the daily **Process Overdue Invoices** cron (`handleOverdueInvoices`). Live MEP refresh only looks at invoices with status **Overdue**, so running MEP without the status flip leaves overdue-block cards empty or wrong even after import.

In the Nest / in-process billing connector path, backfill and incremental sync only recalculate due and overdue rollups after Payment and Invoice ingest. They do not run chronological AR replay, do not run Process Overdue Invoices, do not refresh MEP or capacity gap, and do not enqueue as-of rewrite for past Portfolio Health / trend days. File import job complete similarly refreshes rollups and (for Invoice/Payment) enqueues as-of rewrite, but does not run replay, overdue status flip, or live credit-insurance refresh.

Operators who finish a connector backfill or an invoice/payment file import therefore see wrong invoice status (still Due), wrong or empty capacity gap and MEP until the next daily crons (or a manual repair). Capacity gap sync also skips open invoices that still lack `limit_assessed_amount`, so a live refresh alone cannot fix gap without replay first.

## Solution

Introduce one shared post-ingest orchestrator used by billing connector sync and file import job complete.

**Order when flags are on:** chronological AR replay → deferred-payment maturity when needed → **full Process Overdue Invoices for touched customers** → live MEP and capacity-gap refresh (via the existing customer insurance sync that ends in the capacity-gap pipeline) → as-of rewrite enqueue (do not drain the queue in-request).

- **Process Overdue Invoices** runs for **every** account (collection-only and credit-insurance), outside the credit-insurance-only gate. It uses the same full daily-cron behavior (Due → Overdue, activate customers with debt, open collection periods when applicable) for customers touched by that import/sync only.
- **Replay, maturity, and live MEP/gap** remain credit-insurance-gated.
- Connector runs this once after the Invoice entity finishes (all pages and maturity). If Payment customers were touched but Invoice did not run that orchestration in the same sync, run the same work for those payment-affected customers. File import runs the same orchestrator on Invoice and Payment job complete.
- Preview / dry-run skips all of these side effects. Failures in post-ingest work are logged; the import or sync itself still succeeds. Customers are processed one at a time.
- MEP after the status flip means the existing per-customer live refresh (`syncCustomerInsuranceFields` with follow-up effects), not a second full-account Compute Customer Overdue Metrics cron.

## User Stories

1. As a billing connector operator, I want a completed Invoice sync to refresh MEP for affected credit-insurance customers, so that overdue-block cards are correct without waiting for the daily cron.
2. As a billing connector operator, I want a completed Invoice sync to refresh capacity gap for those customers, so that exposure cards match imported open AR.
3. As a billing connector operator, I want chronological AR replay to run before live capacity gap refresh, so that assessed limits exist and gap amounts are not skipped as null.
4. As a billing connector operator, I want this work to run once after all Invoice pages and deferred-payment maturity, so that a long backfill does not re-run full replay on every page.
5. As a billing connector operator, I want Contact ingest to stay after Invoice post-ingest work, so that AR math is settled before non-AR entities continue.
6. As a billing connector operator, I want a payment-only sync (Invoice skipped or not orchestrated) to still run replay, maturity, overdue status flip, and live refresh for payment-affected customers, so that late ERP payments do not leave status, gap, and MEP stale.
7. As a billing connector operator, I want a full Payment-then-Invoice sync to run post-ingest only once after Invoice, so that we do not double-run replay every night.
8. As a billing connector operator, I want connector sync to enqueue as-of rewrite after that orchestration, so that past Portfolio Health and trend days catch up on the next morning drain like file import.
9. As a billing connector operator, I want preview or dry-run syncs to skip replay, Process Overdue Invoices, live refresh, and as-of enqueue, so that previews never write production side effects.
10. As an accounts receivable clerk, I want finishing an invoice file import job to run the same post-ingest orchestrator, so that connector and file import produce the same live cards and overdue status.
11. As an accounts receivable clerk, I want finishing a payment file import job to run the same orchestrator, so that late payment files correct capacity gap and overdue status without re-importing invoices.
12. As an accounts receivable clerk, I want file import to keep enqueueing as-of rewrite for Invoice and Payment jobs, so that history policy stays consistent with today.
13. As a credit analyst, I want live capacity gap after backfill to reflect chronological open AR at each invoice open, so that sticky assessed limits stay product-correct.
14. As a credit analyst, I want customer MEP (oldest overdue date and overdue block) refreshed after import **after** past-due invoices are marked Overdue, so that Exposure Guard overdue signaling matches imported invoices.
15. As a credit analyst, I accept that past snapshot days update by the next morning after connector or file import, so that imports stay faster than in-request history rewrite.
16. As a credit manager on a collection-only account, I want post-ingest replay and credit refresh skipped when the account does not have credit insurance, so that large backfills are not slowed for no product benefit.
17. As a credit manager on a collection-only account, I still want due and overdue rollups recalculated after sync, so that collection views keep working.
18. As a credit manager on a collection-only account, I want Process Overdue Invoices to still run for touched customers after import, so that past-due invoices become Overdue without waiting for the daily cron.
19. As an operations engineer, I want post-ingest failures logged without failing the sync or import job status, so that a replay or overdue-job crash on one customer does not mark a successful ingest as FAILED.
20. As an operations engineer, I want imported invoice and payment rows to remain saved when post-ingest fails, so that we can re-run refresh without re-pulling the ERP.
21. As an operations engineer, I want customers processed one at a time during post-ingest, so that behavior matches the daily overdue metrics job and failures are easier to diagnose.
22. As a platform engineer, I want one shared orchestrator for connector and file import, so that the two paths cannot drift on order or flags.
23. As a platform engineer, I want live refresh to reuse the existing customer insurance sync follow-up (MEP fields plus capacity-gap pipeline), so that we do not invent a second gap writer.
24. As a platform engineer, I want a thin `triggerPostImportOverdueMetrics` entry that only runs that live refresh for eligible customers, so that call sites stay readable and match prior product vocabulary.
25. As a platform engineer, I want chronological AR replay ported into the Nest credit/import domain, so that Nest connector and file import no longer depend on a dead Next server module path.
26. As a platform engineer, I want the live in-process sync path to own this behavior, so that we do not rely on the unused BillingConnectorSyncService that still points at missing server modules.
27. As a developer, I want connector host wiring for post-ingest to follow the same pattern as customer balance recalculation (callback or host require), so that the billing-connector package stays free of a hard Nest dependency.
28. As a developer, I want non–credit-insurance gating to skip only credit steps (replay, maturity, live MEP/gap), while Process Overdue Invoices still runs for touched customers on every account.
29. As a developer, I want orchestrator options for replay, maturity, Process Overdue Invoices, live refresh, and as-of enqueue flags, so that Invoice vs payment-only vs file complete can share one function with different switches.
30. As a support engineer, I want sync logs to mention when post-ingest refresh starts, succeeds, or fails (including the overdue status step), so that ops can see whether status flip, MEP, and gap ran after a backfill.
31. As a QA engineer, I want to verify after connector backfill that a customer over limit shows non-zero capacity gap without waiting for the daily cron, so that D1 is observable in the UI.
32. As a QA engineer, I want to verify that past-due imported invoices are Overdue before MEP assertions, so that the status flip is observable.
33. As a QA engineer, I want to verify MEP overdue block updates after importing overdue invoices in a connector or file job, so that MEP refresh is observable.
34. As a QA engineer, I want to verify a payment-only connector run updates live gap for an existing open invoice customer, so that the payment-only fallback is covered.
35. As a QA engineer, I want to verify a collection-only account backfill does not spend time in credit replay/refresh but still flips Due → Overdue for touched customers, so that D6 / D12 are observable in logs or status.
36. As a product owner, I want UI/API single payment create left out of this delivery, so that import and connector land first and reuse the same orchestrator later.
37. As a product owner, I want this PRD to align with deferred-payment chronological import and payment-triggered AR replay, so that one orchestration model covers all planned entry points over time.
38. As a credit operations user, I want incremental connector syncs to use the same post-Invoice orchestrator as backfill, so that nightly deltas keep cards and overdue status fresh.
39. As a credit operations user, I want cancelled or stopped syncs not to invent a full post-ingest pass for pages that never finished Invoice, so that partial runs stay predictable (best-effort only for customers already accumulated when orchestration is reached).
40. As a developer maintaining tests, I want the shared orchestrator tested as the primary seam, so that caller tests only assert flags and when they invoke it.
41. As a platform engineer, I want as-of rewrite enqueue on the connector path to use the same queue semantics as file import (merge/coalesce existing rules), so that drain ownership stays with the morning cron.
42. As an ARchaser admin, I want no schema or translation changes for this work, so that rollout stays a behavior wiring and domain port.

## Implementation Decisions

- Build one shared AR post-ingest orchestrator (name flexible, e.g. run AR post-ingest for customers) used by billing connector sync and file import job complete.
- Orchestrator order when flags are on: chronological AR replay → deferred-payment maturity (connector payment-only / when required) → **full Process Overdue Invoices for touched customers** → live MEP and capacity-gap refresh → as-of rewrite enqueue (do not drain the queue in-request).
- Process Overdue Invoices step: call existing `handleOverdueInvoices` (or Nest-equivalent wrapper) **per touched customer**, with the same full daily-cron behavior (status flip, amount recalc, customer activate, collection period open when applicable). Scope is customers touched by this import/sync only — not a full-account sweep.
- Process Overdue Invoices runs for **all accounts** (outside the credit-insurance-only gate). Replay, maturity, and live MEP/gap remain CI-gated. Restructure the orchestrator so non-CI accounts do not early-return before the overdue step (and as-of enqueue behavior for collection-only stays correct).
- Live refresh is a thin `triggerPostImportOverdueMetrics` that, for each eligible customer, calls existing `syncCustomerInsuranceFields` with follow-up effects (MEP / overdue block plus capacity-gap pipeline). Do not call the gap pipeline alone without that customer sync. Do not also run the full-account Compute Customer Overdue Metrics cron as part of import.
- Port chronological AR replay into the Nest domain from the legacy import AR replay module (source of truth currently outside the live Nest tree). Replay must stamp assessed limits so capacity gap sync does not skip null assessments.
- Reimplement `triggerPostImportOverdueMetrics` in Nest; it was intentionally skipped in the old credit-insurance domain port script and is not present as a live module today.
- Wire the live connector path (`runInProcessSync` / staged extension sync), not the unused BillingConnectorSyncService that still imports missing Next `@/server/...` modules.
- Connector timing: run orchestrator once after the Invoice entity completes (all pages and existing maturity). Before Contact continues.
- Connector payment-only fallback: if Payment ingest touched AR customers and Invoice did not run post-Invoice orchestration in that sync, run the same orchestrator for those customers (including maturity and Process Overdue Invoices).
- File import: on Invoice and Payment job complete, call the same orchestrator for affected customers (with as-of enqueue as today or via the shared helper).
- Skip orchestrator credit work when the account does not have credit insurance; **still run Process Overdue Invoices** for touched customers; keep existing due/overdue rollup refresh for all accounts.
- Skip orchestrator side effects (including Process Overdue Invoices) on preview / dry-run.
- Process eligible customers sequentially (one at a time), matching daily overdue metrics / Process Overdue Invoices.
- On orchestrator errors: log and continue; do not fail overall sync or import job SUCCESS solely because post-ingest failed; do not roll back ingested rows.
- Host wiring for connector/cron workers: optional callback from Nest and/or dynamic host require, same architectural idea as customer amount recalculation host.
- No Prisma schema changes. No translation file changes.
- Out of this delivery: UI/API single payment create (owned as follow-up; payment-triggered AR replay PRD remains the product home for that path).
- Cross-reference deferred-payment chronological import and payment-triggered AR replay PRDs; this PRD is the Nest wiring + port slice that makes live connector/file import actually run the promised post-ingest credit refresh and overdue status flip.

### Grill decision log (D1–D9 — original post-ingest)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Capacity gap on backfill | Ship live refresh together with chronological AR replay |
| D2 | Entry points | Connector sync and file import job complete (Invoice and Payment) |
| D3 | Connector timing | Once after Invoice entity finishes (all pages + maturity) |
| D4 | Payment-only connector | Same replay + maturity + live refresh when Invoice did not orchestrate |
| D5 | Failure handling | Best-effort log; import/sync stays SUCCESS |
| D6 | Non-CI accounts | Skip replay and live MEP/gap when credit insurance is off |
| D7 | UI payment create | Out of v1 |
| D8 | As-of rewrite from connector | Enqueue after connector Invoice / payment-only orchestration |
| D9 | Customer fan-out | One customer at a time |

### Grill decision log (D10–D19 — Process Overdue Invoices after import)

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D10 | Which overdue work | Both — flip Due → Overdue, then refresh MEP | MEP only sees `status: Overdue` |
| D11 | Sequence | After replay + maturity, before live MEP refresh | Replay treats Due/Overdue the same; MEP does not |
| D12 | Collection-only accounts | Run status flip for every account (outside CI gate) | Collection lists need Overdue |
| D13 | Customer scope | Only customers touched by this import/sync | Same fan-out as post-ingest |
| D14 | Job depth | Full Process Overdue Invoices | Match daily cron (status + activate + collection period) |
| D15 | Entry points | Same as post-import (connector Invoice + payment-only + file Invoice/Payment) | One wiring rule |
| D16 | On failure | Keep SUCCESS — log and continue | Same as other post-ingest steps |
| D17 | Preview / dry-run | Skip the overdue job | No live writes from preview |
| D18 | Ownership | Extend shared orchestrator — overdue always; credit steps stay CI-gated | Avoid early-return skipping collection accounts |
| D19 | Plan home | Update this PRD (not a separate feature doc) | One pipeline |

## Testing Decisions

- Good tests assert external behavior at orchestration seams: given a completed ingest path, replay, Process Overdue Invoices, and live refresh are invoked (or skipped) per the rules above. Do not assert internal loop counters inside the replay engine once that module has its own unit coverage.
- Prefer the fewest seams. Ideal primary seam: the shared post-ingest orchestrator (one thorough unit suite for order, flags, CI gate vs overdue-always, best-effort errors, sequential fan-out).
- Thin caller seams (assert they invoke the orchestrator with the right options, not re-test pipeline math):
  1. File import job complete — Invoice and Payment.
  2. Billing connector staged/in-process sync — once after Invoice; payment-only fallback when Invoice orchestration did not run; dry-run skips.
- Assert overdue-before-MEP order: a past-due invoice imported as Due is Overdue before live MEP refresh runs (or mock order in the orchestrator suite).
- Assert collection-only: overdue step runs; replay and live MEP/gap do not.
- Do not make UI payment create a required seam for this PRD (out of scope).
- Prior art: deferred-payment / payment-triggered AR replay PRD testing notes; billing connector sync wiring tests; import job complete behavior; daily `handleOverdueInvoices` / `computeCustomerOverdueMetrics`; legacy `importArReplayService` tests in the old tree as a port reference.

### Chosen seams

1. Shared AR post-ingest orchestrator (primary) — including Process Overdue Invoices step and non-CI early-return refactor.
2. Import job complete (Invoice / Payment) — thin.
3. Connector sync orchestration (post-Invoice once; payment-only fallback) — thin.

## Out of Scope

- UI/API single linked payment create (backdated or same-day).
- Per-page live refresh or per-page chronological replay during backfill.
- Parallel customer fan-out or background queue that finishes the sync before refresh completes.
- In-request drain of as-of rewrite for past CustomerPolicyTrend / CreditDashboardDailySnapshot days.
- Changing as-of rewrite merge rules or morning cron drain ownership.
- Relying on or expanding BillingConnectorSyncService as the live sync engine (leave unused or clean up separately).
- Schema migrations, translation updates, new UI screens.
- Combined invoice+payment import wizard.
- Payment update/delete chronological replay beyond existing create/import paths.
- Changing golden-loop harness fixtures unless a regression appears.
- Running the full-account Compute Customer Overdue Metrics cron as part of import (per-customer live refresh after status flip is enough).
- Full-account Process Overdue Invoices sweep on every sync (touched customers only).

## Further Notes

### Discovery gates (blocking)

| Gate | If Yes | If No | Blocks |
|------|--------|-------|--------|
| Port chronological AR replay from the legacy import AR replay module into Nest | Use as replay implementation | Rewrite from PRDs and stamp helpers before gap refresh | Replay step |
| Ported replay stamps `limit_assessed_amount` for open invoices that lack assessment | Live gap pipeline can populate amounts | Add an explicit stamp pass before gap sync | Gap after replay |
| Connector-scale as-of enqueue via existing import rewrite helper is safe | Wire after orchestration | Batch/cap enqueue or spike before D8 | Connector as-of |
| Nest orchestrator can call `handleOverdueInvoices` from `@archaser/cron-jobs` (or a thin Nest wrapper) without circular deps | Wire as orchestrator step | Port/wrap overdue processing into Nest domain first | D10–D18 overdue step |
| Orchestrator early-return for non-CI can be restructured so overdue (+ collection-only as-of enqueue) still runs | Single pipeline | Temporary dual path until refactor | D12 / D18 |

### Related PRDs

- `deferred-payment-chronological-import.prd.md` — payment-first ingest, maturity, replay product rules.
- `payment-triggered-ar-replay.prd.md` — payment job complete and UI create; this PRD delivers Nest connector/file wiring and explicitly defers UI create.
- `billing-connector-dated-backfill.prd.md` — assumes post-Invoice replay and post-import credit refresh; Nest must implement that assumption here.

### Suggested follow-ups

- Wire UI/API backdated payment create to the same orchestrator (payment-triggered AR replay).
- Optional parallel fan-out if large backfills stay RUNNING too long after Invoice.
- Retire or wrap unused BillingConnectorSyncService so it cannot be mistaken for the live path.

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under `.scratch/import-ar-post-ingest-refresh/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.scratch/import-ar-post-ingest-refresh/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Port replay and shared post-ingest orchestrator | `issues/01-orchestrator-and-replay-port.md` | — | 3, 22–25, 28–29, 40 |
| 2 | Wire file import job complete (Invoice and Payment) | `issues/02-file-import-job-complete.md` | 01 | 10–14, 16–20 |
| 3 | Wire connector post-Invoice orchestration and as-of enqueue | `issues/03-connector-post-invoice.md` | 01 | 1–5, 7–9, 16–20, 26–27, 30–33, 35, 38 |
| 4 | Connector payment-only post-ingest fallback | `issues/04-connector-payment-only-fallback.md` | 03 | 6, 7, 34 |
| 5 | Process Overdue Invoices step + non-CI orchestrator gate refactor | `issues/05-process-overdue-after-import.md` | 01 | 6, 9, 14, 18, 28–29, 32, 35 |

**Status:** `ready-for-agent` on all slices.

*Soft ordering:* slices 02 and 03 can proceed in parallel after 01; slice 05 can proceed after 01 (may land with or after 02/03 if orchestrator already exists — call sites pick up the overdue step automatically).
