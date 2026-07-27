---
name: as-of-daily-snapshot-rewrite
overview: Reconstruct CustomerPolicyTrend and CreditDashboardDailySnapshot history using payment-ledger as-of open AR, with coalesced rewrite queue drained by daily snapshot crons and ARchaser-admin per-account full-history backfill (Billing-tab status modal).
source: grill-me session (late invoice / as-of daily snapshots + admin screen)
clickup_task_url: https://app.clickup.com/t/869e3jznb
isProject: false
---

# As-of Daily Snapshot Rewrite

## Problem Statement

Credit-insurance daily history (`CustomerPolicyTrend` and `CreditDashboardDailySnapshot`) is written from **live** open AR at snapshot time. When analysts import invoices early in the month with `invoice_date` on the last day of the prior month—or enter payments, limits, or top-ups late—past snapshot days do **not** update. Period analytics (including Credit Portfolio Health) then understate historical AR and Health for those days.

There is no invoice status-history table. Re-stamping a past `snapshot_date` with today’s live book would pollute history (paid invoices vanish; newer invoices appear). Analysts need past days to mean “what was open **as of that day**,” corrected when late-dated documents arrive, without blocking large imports.

## Solution

1. **As-of open AR** — For snapshot day D, include invoices with `invoice_date ≤ D` that are not Void/Cancelled (or equivalent), with open amount from a **payment ledger**: original amount minus linked `InvoicePayment`s with `payment_date ≤ D`. Treat remaining balance as Due/Overdue using `due_date` vs D.

2. **Health family on the same open set** — Terms breach, at-risk, compliant, and health for day D are computed from those as-of open invoices using stored CTV / reporting flags. Policy limit, top-up, and cost resolution stay on `snapshotDate` as today (top-ups already date-bounded).

3. **Shared helper** — One as-of open-AR (+ Health family) primitive feeds **CustomerPolicyTrend** and **CreditDashboardDailySnapshot**. Insurance policy trend writers stay out of scope unless they reuse the helper for free.

4. **Coalesced rewrite queue** — Invoice/payment/policy/top-up changes enqueue `{ accountId, customerIds, fromDate, toDate }` with merge of overlapping ranges. Imports set `fromDate` to the **minimum successful** `invoice_date` / `payment_date` in that job. Drain runs **inside or right after** existing daily CPT and dashboard snapshot crons (next-morning correction).

5. **Full-history cutover (per account)** — ARchaser admin (session account **10013**) opens a **status modal** from the target account’s **Billing integration** tab (only if that account has credit insurance). Start (with confirm) / Resume / Pause / Status call an admin API that runs **immediate async** batched as-of recompute for **that account only** (checkpoints; no auto-run on deploy; independent of nightly snapshot crons). Fleet cutover = run per account.

6. **Prerequisite for Portfolio Health** — Land this before trusting period KPIs on historical CPT/dashboard rows; portfolio-health PRD documents as-of semantics and next-morning lag.

## User Stories

1. As a credit analyst, I want a past snapshot day to reflect invoices that belong on that day, so that late imports do not permanently understate historical AR.

2. As a credit analyst, I want open balance on day D to subtract only payments dated on or before D, so that later payments do not erase earlier open exposure.

3. As a credit analyst, I want Due vs Overdue on day D to follow `due_date` vs D for as-of open amounts, so that aging on that day is meaningful.

4. As a credit analyst, I want Health / compliant / at-risk on rewritten days to use the same as-of open invoices, so that Health is not incoherent with AR.

5. As a credit analyst, I want Void/Cancelled invoices excluded from as-of open AR, so that cancelled documents do not inflate history.

6. As a credit analyst, I accept that unlinked payments and status-only closes may leave known gaps, so that we ship ledger reconstruction without inventing missing history tables.

7. As a credit analyst, I want CustomerPolicyTrend history corrected when late invoices arrive, so that customer and portfolio trends stay trustworthy.

8. As a credit analyst, I want CreditDashboardDailySnapshot history corrected the same way, so that no-policy and portfolio gauges over a period stay aligned with CPT.

9. As a credit analyst, I do not require InsurancePolicyTrend as-of rewrite in this release, so that scope stays focused on CPT and dashboard snapshots.

10. As an operations user running early-month invoice imports, I want the import request to stay fast, so that bulk loads are not blocked by multi-day recomputes.

11. As the system, I want one coalesced queue row per overlapping account/date range, so that thousands of invoice rows do not fan out into thousands of rewrite jobs.

12. As the system, I want import completion to set `fromDate` to the earliest successful invoice or payment date in that job, so that last-day-of-prior-month batches rewrite from the right anchor.

13. As the system, I want UI/API invoice create/update to enqueue the same rewrite work, so that non-import edits follow the same correction path.

14. As the system, I want linked payment create/update/delete to enqueue rewrite from the payment date (merged), so that settlements correct historical open AR.

15. As a credit manager, I want CustomerPolicy limit/config changes to enqueue a rewrite window using the **current** limit, so that utilization history reflects the corrected limit even without effective-dated limit history.

16. As a credit manager, I want creating or updating a top-up with a past `start_date` to enqueue rewrite from that start (or previous start if shortened), so that late-entered cover appears on the days it spans.

17. As a credit manager, I understand that cancelling a top-up removes it from all rewritten days under current `cancelled_at` rules, so that I do not expect “active until cancel day” without a later change.

18. As the system, I want the daily CPT and dashboard snapshot crons to drain the rewrite queue, so that one operational cadence applies today and historical corrections.

19. As a credit analyst, I accept that after a late import, history is typically correct by the **next morning**, so that I do not expect instant past-day updates in the UI.

20. As an ARchaser admin (account 10013), I want a control on the account detail **Billing integration** tab (when the target has credit insurance) that opens an as-of backfill status modal, so that I can run full-history recompute without curl.

21. As an ARchaser admin, I want the modal to show live status (idle/running/paused/failed/complete), date range, days done/total, last checkpoint, last error, and started/updated times, so that I can judge progress without opening the DB.

22. As an ARchaser admin, I want Start to ask for confirmation, then kick an **immediate async** full-history backfill for **this account only**, so that I do not wait for nightly crons and do not accidentally start a heavy rewrite.

23. As an ARchaser admin, I want Resume after pause without a second confirm, and Pause while running (stop at next checkpoint), so that I can control load without losing progress.

23b. As an ARchaser admin, I want closing the modal to stop polling only (job continues), so that long runs are not tied to keeping the browser open.

23c. As an ARchaser admin, I want Start available again when idle/complete/failed (with confirm) to reset checkpoints and recompute from scratch, so that I can re-run after data or logic fixes.

23d. As an ARchaser admin, I do not want backfill to auto-run on deploy, so that production load stays intentional.

23e. As the system, I want per-account backfill to process days in batches with checkpoints and yield, so that nightly “today” snapshots still complete.

24. As a developer, I want a single as-of open-AR / Health-family builder as the primary test seam, so that ledger math is unit-tested without UI or full cron harnesses.

25. As a developer, I want queue coalesce/merge behavior tested at the queue service boundary, so that bulk imports do not regress into per-row job storms.

26. As a developer, I want CPT and dashboard writers to call the same as-of helper when writing any `snapshotDate`, so that today and historical days share one definition.

27. As a product owner, I want this workstream treated as a prerequisite for trusting Credit Portfolio Health period KPIs, so that analytics are not shipped on knowingly stale history.

28. As a product owner, I want known limitations documented (unlinked payments, status-only closes, imported totals without payment rows, reporting/gap stamps not fully temporal), so that support and analysts know what as-of does not claim.

29. As a QA engineer, I want fixtures for late invoice import (invoice_date in the past) plus queue drain to assert past CPT/dashboard days include the invoice, so that the month-boundary scenario is regression-proof.

30. As a QA engineer, I want fixtures for payment dated after an open day to leave that day’s open AR unchanged, so that ledger as-of is verified.

31. As a QA engineer, I want a top-up with past start_date, after drain, to increase effective limit on covered days only, so that date-bounded cover is verified.

32. As an ARchaser admin, I want only session account **10013** callers to invoke backfill start/resume/pause/status (API enforced even if UI is hidden), so that other account admins cannot trigger rewrite.

33. As the system, when rewriting dashboard snapshots for a day, I want full account scopes recomputed, so that aggregates stay consistent even if only one customer’s invoices changed.

34. As the system, when rewriting CPT, I want only touched customers’ rows upserted for those days, so that work scales with affected customers rather than the whole book when possible.

35. As a developer, I want original amount vs payment amounts to follow the same currency preference as live open AR (`amount`/`InvoicePayment.amount` vs `customer_amount` pair), so that as-of history does not diverge from live COALESCE rules.

## Implementation Decisions

### Semantics (as-of day D)

- Open invoice on D: `invoice_date ≤ D`, not Void/Cancelled (or equivalent exclusion set agreed in implementation).
- Open amount: `max(0, original − Σ linked InvoicePayment with payment_date ≤ D)`.
- Original/payment field pair: match live open-AR currency preference (invoice currency vs customer currency COALESCE spirit).
- Status for open amount &gt; 0: Due/Overdue from `due_date` vs D.
- Health family: terms breach / at-risk / compliant / health from as-of open invoices + stored CTV and reporting flags.
- Limits, top-ups, costs: resolve on `snapshotDate` as current writers do (top-ups filtered by start/end and `cancelled_at`).
- Document gaps: unlinked payments, status-only closes, imported `total_paid` without payment rows, non-temporal reporting/gap stamps; top-up cancel clears all rewritten days.

### Writers in scope

- Shared as-of helper used by CustomerPolicyTrend sync and CreditDashboardDailySnapshot upserts for every `snapshotDate` (including today).
- InsurancePolicyTrend: out of scope unless the helper is reused with negligible extra work.

### Rewrite queue

- Durable work item shape: `{ accountId, customerIds?, fromDate, toDate }` with merge of overlapping ranges per account (widen date span; union customer ids when present).
- Enqueue sources:
  - Invoice/payment **import job completion**: `fromDate = min(successful rows’ invoice_date or payment_date)`, `toDate = today`, affected customer ids.
  - UI/API invoice create/update; linked payment create/update/delete; CustomerPolicy limit/config change; CustomerTopUp create/update/cancel — same queue, event-appropriate anchors (invoice_date, payment_date, policy lookback window using current limit, top-up `min(start, previous start)`).
- Drain: inside or immediately after existing daily CPT + dashboard snapshot crons; process pending items with as-of math for `[fromDate, today]`; CPT for touched customers; full dashboard scopes per day.
- Imports must not block on drain; queue write only at completion.

### Admin full-history backfill (UI + API)

- **Scope:** One target account per run (full CPT + dashboard snapshot days from min existing snapshot date → today). Fleet = repeat per account (no fleet UI in this PRD).
- **Entry:** Account detail → **Billing integration** tab → distinct as-of snapshot backfill control → status modal. Visible only when session `account_id === 10013` **and** target `has_credit_insurance`. Separate from billing-connector sync actions on the same tab.
- **Modal:** Poll status while open. Actions: **Start** (confirm dialog first), **Resume** (when paused/failed; no second confirm), **Pause/Stop** while running (pause at next checkpoint). Actions disabled while `running`. Closing modal does not stop the job.
- **Start / Resume execution:** Immediate **async** batched backfill for that account (not queued for nightly CPT/dashboard drain).
- **Re-run:** When `idle` / `complete` / `failed`, Start + confirm resets checkpoints and recomputes full history from scratch.
- **API:** start / resume / pause / status scoped by `accountId`; auth = session account 10013 (same patterns as other admin system APIs). No auto-run on deploy.
- **Status payload (ops-minimal):** `idle` | `running` | `paused` | `failed` | `complete`; date range (min → today); days done / days total; last checkpoint date; last error (if any); started / updated timestamps.
- Reuse existing admin patterns (`AppDialog`, account detail cards); no new permission key; EN/HE strings only after explicit translation permission.

### Delivery

- Separate prerequisite workstream before trusting Credit Portfolio Health period KPIs on history.
- Portfolio-health PRD updated to depend on this; remove “no CPT writer change”; document as-of semantics and next-morning lag.

### Schema

- New durable queue (and backfill checkpoint) storage as needed for coalesce + admin status. Prefer minimal new tables over ad-hoc JSON mining of ImportRecord.

## Testing Decisions

### Primary test seam (confirm before `/to-issues`)

**One primary seam:** the **as-of open-AR + Health-family builder** (exported pure/service function): given invoice + linked payment fixtures and as-of date D, assert open amounts, Due/Overdue classification, and Health-family inputs/outputs.

**Secondary seam (same workstream, thin):** rewrite **queue coalesce/merge** — enqueue overlapping ranges → one widened work item; import completion uses min date.

Avoid asserting SQL shape of CPT upserts or cron wiring in unit tests; cover writer wiring with focused service tests that the helper is used for a past `snapshotDate`. Admin backfill: API auth + status/pause/resume state machine unit tests; light UI tests optional (visibility gate 10013 + has_credit_insurance) following account-detail admin patterns — not required if API seam is solid.

Please confirm this seam split matches expectations before `/to-issues` slicing.

### What makes a good test

- Assert observable balances and Health-family numbers for day D, not internal query structure.
- Cover: late invoice with past `invoice_date`; payment after D; Void/Cancelled excluded; currency preference pair; top-up date bounds; queue merge under bulk import dates; admin API rejects non–ARchaser admin.

### Modules under test

- As-of open-AR / Health-family builder (primary).
- Rewrite queue enqueue/merge (secondary).
- Admin backfill API authorization + pause/resume/complete/re-run status shape (lightweight).
- Optional: Billing-tab control visibility (10013 + has_credit_insurance).

### Prior art

- CustomerPolicyTrend snapshot / daily cost / gap-fill unit tests.
- Credit dashboard snapshot service tests.
- Open receivable / terms-breach unit tests in credit insurance.
- System/admin API auth patterns for account 10013 / `archaser_admin`.
- Account detail Billing integration sync actions / `AppDialog` modals on account details.

## Out of Scope

- True effective-dated `approved_limit` history (policy edit rewrites use **current** limit).
- Changing `cancelled_at` semantics to “active until cancel day.”
- As-of rewrite for InsurancePolicyTrend (unless free via shared helper).
- Instant synchronous historical rewrite on import request.
- Scanning ImportRecord JSON inside the drain cron (dates captured at import completion instead).
- Auto-running full backfill on deploy.
- Fleet-wide backfill UI or standalone `/admin` backfill page (per-account modal only).
- Rich backfill metrics (CPT row counts, rates) beyond ops-minimal status fields.
- Portfolio Health UI freshness banner (optional later).
- New invoice status-history or payment-allocation history tables beyond using existing InvoicePayment rows.
- Fixing unlinked / deferred payments completeness as a data-quality project.

## Further Notes

### Decision log (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Historical rewrite semantics | As-of reconstruction (not live re-stamp) |
| D2 | Open-as-of-D formula | Payment-ledger reconstruction |
| D3 | Writer scope | Shared helper + CPT + CreditDashboardDailySnapshot; defer InsurancePolicyTrend |
| D4 | As-of depth | AR + Health family from as-of open invoices; limits/costs on snapshotDate |
| D5 | Triggers | Event-driven enqueue on invoice + payment (+ later D7/D12) |
| D6 | Late policy limit | Rewrite window with **current** limit on CustomerPolicy change |
| D7 | Top-up events | Same event-driven enqueue from min(start, prev start) |
| D8 | Window | Event-anchored, uncapped; processed async via queue (not inline) |
| D9 | Execution | Enqueue + cron drain with coalescing; import `fromDate` = earliest date in batch |
| D10 | Import date capture | Compute at import completion; drain reads queue only |
| D11 | Drain cadence | Inside / right after existing daily CPT + dashboard snapshot crons |
| D12 | Non-import mutations | Same queue for UI/API invoice, payment, policy, top-up |
| D13 | Ledger amount basis | Match live open-AR currency preference |
| D14 | vs Portfolio Health | Separate prerequisite workstream; update that PRD |
| D15 | Existing history | Full history backfill |
| D16 | Backfill execution | Dedicated batched job; ARchaser admin only |
| D17 | Backfill trigger | Admin-only API start/resume/status; no auto deploy |
| D18 | Admin surface | Modal from account detail → Billing integration tab |
| D19 | Backfill UI scope | This account only |
| D20 | Control visibility | Session 10013 + target has_credit_insurance |
| D21 | Modal workflow | Status modal; Start/Resume; poll while open |
| D22 | Stop | Pause at next checkpoint; Resume continues |
| D23 | Start execution | Immediate async (not nightly cron) |
| D24 | Confirm | Confirm dialog on Start only |
| D25 | Re-run when complete | Start + confirm; reset; full recompute |
| D26 | Status fields | Ops-minimal (status, range, days done/total, checkpoint, error, timestamps) |

### Related work

- Credit Portfolio Health analytics (`.cursor/plans/credit-portfolio-health.prd.md`) depends on this for trustworthy period history.
- Existing daily crons: customer policy trend snapshots; credit dashboard daily snapshots.
- Account admin Billing integration tab (billing-connector backfill is a separate feature on the same tab).

### Next step

Vertical slices published (see below). Implement in dependency order; start a **fresh session per issue**.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown.

**Parent:** [As-of Daily Snapshot Rewrite](https://app.clickup.com/t/869e3jznb)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | As-of open AR and Health-family builder | [869e3jzp4](https://app.clickup.com/t/869e3jzp4) | — | 1–6, 24, 28, 30, 35 |
| 2 | Wire as-of helper into CPT and dashboard writers | [869e3jzpb](https://app.clickup.com/t/869e3jzpb) | 1 | 7–8, 26, 33–34 |
| 3 | Rewrite queue, import enqueue, and daily cron drain | [869e3jzpk](https://app.clickup.com/t/869e3jzpk) | 2 | 10–12, 25, 29 |
| 4 | Enqueue rewrite from invoice, payment, policy, and top-up mutations | [869e3jzpt](https://app.clickup.com/t/869e3jzpt) | 3 | 13–19, 31 |
| 5 | Admin as-of backfill API and Billing-tab status modal | [869e3jzq1](https://app.clickup.com/t/869e3jzq1) | 2 | 20–23e, 32 |

**Assignee / status:** Nilotpal Bose; Selected for Development on parent and all slices.

**Related:** [Coverage performance assesment](https://app.clickup.com/t/869e2mdbc) (portfolio health; non-blocking link).
