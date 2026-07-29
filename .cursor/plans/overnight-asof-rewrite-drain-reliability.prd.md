# Overnight as-of rewrite drain reliability — PRD

Status: ready-for-agent

## Problem Statement

Credit Portfolio Health and other period analytics read historical Customer
Policy Trend (CPT) rows. Late invoices, payments, policy edits, and top-ups
already enqueue a coalesced as-of rewrite window so past days can be corrected
overnight. That overnight drain only runs at the end of the Customer Policy
Trend Daily Snapshot cron.

In practice the drain is fragile: if today’s CPT write fails, drain never
starts; drain failures can still look like a successful cron; a crash or timeout
can leave a queue row stuck in `processing` forever; a long date window restarts
from the beginning every night and may never finish; and an admin full-history
as-of backfill can race the same account’s overnight drain. Separately, accounts
can already have hollow CPT history (rows exist with empty open AR) that is not
in the rewrite queue at all—overnight drain never heals those days unless an
operator runs the existing per-account admin backfill.

Analysts then see contradictions such as Credit Insurance Dashboard trend
showing real open AR while Portfolio Health Lowest point shows 0% for the same
dates (Mondeo Ltd, July 1–8), until someone rewrites by hand.

## Solution

Keep the existing product shape: event-driven enqueue plus overnight drain on
the CPT cron only—no hollow-day scanner and no fleet auto full-history on
deploy. Harden that overnight path so queued rewrites reliably complete, report
failures clearly, resume after interruptions, and do not race an in-progress
admin backfill. At ship time, operators run the existing Billing-tab
full-history as-of backfill once per credit-insurance account to clear
already-broken history; after that, only newly enqueued windows rely on the
hardened overnight drain. Ops treats “CPT cron active and running nightly” as a
ship checklist item with alerts if the job is inactive or misses a night.

## User Stories

1. As a credit analyst, I want late-dated invoice imports to correct historical
   CPT open AR by the next successful overnight drain, so that Portfolio Health
   period KPIs catch up without a manual rewrite.
2. As a credit analyst, I want linked payment create/update/delete to correct
   historical open AR overnight, so that settlements do not permanently distort
   past Health.
3. As a credit manager, I want Customer Policy and top-up changes to enqueue the
   same overnight rewrite path, so that utilization and Health history stay
   coherent with current limits and cover.
4. As a credit analyst, I want overnight rewrite to still run when today’s CPT
   snapshot write fails, so that already-queued history fixes are not blocked by
   an unrelated today-write error.
5. As an operations engineer, I want the CPT cron run to be marked failed or
   partial-failed when rewrite drain fails, so that a stuck queue is not hidden
   behind a green success.
6. As an operations engineer, I want drain failures visible in cron steps/logs
   with item and failure counts, so that I can diagnose overnight correction
   problems quickly.
7. As the system, I want stale `processing` rewrite queue rows older than 60
   minutes reclaimed to `pending` on the next drain, so that a timed-out or
   crashed cron does not strand work forever.
8. As the system, I want a long rewrite window to checkpoint the last completed
   day and resume from the next day on the following drain, so that multi-month
   windows can finish across nights instead of restarting from `fromDate`.
9. As the system, I want overnight drain to skip an account while that account’s
   admin as-of backfill status is `running` or `paused`, so that two writers do
   not race the same CPT and Credit Dashboard Daily Snapshot days.
10. As the system, I want a skipped-for-backfill queue row to remain pending and
    be drained after backfill completes, so that import-driven corrections are
    not lost.
11. As an ARchaser admin, I want to keep using the Billing-tab as-of backfill
    modal to run full-history recompute for one credit account, so that cutover
    of already-broken history stays controlled.
12. As an ARchaser admin, I want ship cutover to be “start each credit-insurance
    account from the Billing modal,” so that we do not need a new fleet kickoff
    API.
13. As an operations engineer, I want a ship checklist that CPT Daily Snapshot
    cron is active, so that overnight drain has a scheduler to run on.
14. As an operations engineer, I want an alert when that CPT cron is inactive or
    misses a night, so that queue backlog is noticed without waiting for analyst
    reports.
15. As a credit analyst, I accept that hollow CPT days that were never enqueued
    are fixed by the one-time admin backfill cutover (not by a continuous
    scanner), so that ongoing automation stays limited to the rewrite queue.
16. As a credit analyst, I want Customer Policy Trend and Credit Dashboard Daily
    Snapshot for rewritten days to stay on the same as-of open AR /
    Health-family writers, so that dashboard trend and Portfolio Health stop
    disagreeing after corrections land.
17. As the system, I want rewrite drain to remain only on the CPT cron (not a
    separate cron and not also on the dashboard cron), so that operational
    cadence stays one job to harden.
18. As the system, I want reclaim age to be 60 minutes (above the 30-minute CPT
    cron timeout), so that a live drain is unlikely to be double-claimed.
19. As an operations engineer, I want attempts and `last_error` on failed queue
    items to keep updating when drain fails mid-window after reclaim, so that
    repeated overnight failures are inspectable.
20. As a credit analyst, I want short windows (for example eight calendar days)
    to complete in a single overnight drain when the cron is healthy, so that
    typical import corrections do not need multi-night progress.
21. As the system, I want coalesced pending rows per account to keep merging
    date ranges and customer sets as today, so that bulk imports do not fan out
    into one job per row.
22. As an ARchaser admin, I want closing the backfill modal to leave both
    backfill and later overnight drain unaffected, so that long cutovers are not
    tied to the browser.
23. As an operations engineer, I do not want a migration that force-sets CPT
    cron `active = true` on every deploy, so that intentionally disabled
    environments are not surprised.
24. As a product owner, I do not want auto full-history backfill on deploy or a
    hollow-day scanner in this release, so that scope stays “make the existing
    overnight queue reliable.”
25. As a QA engineer, I want deterministic unit coverage for reclaim, checkpoint
    resume, drain-after-today-failure, drain-failure reporting, and
    skip-while-backfill-running, so that regressions in overnight reliability
    are caught without a full cron environment.
26. As a credit analyst, I want Portfolio Health Lowest point after a successful
    overnight correction to reflect minimum daily as-of Health in range (not 0%
    from empty CPT AR plus without-policy add-on alone), so that the
    Mondeo-class symptom does not return for newly enqueued windows.
27. As the system, when drain skips an account due to admin backfill, I want
    that skip counted/logged distinctly from hard failures, so that ops can tell
    “deferred” from “broken.”
28. As an operations engineer, I want documentation in the plan/ship notes
    listing per-account cutover after harden ships, so that the eight (or
    current) credit-insurance accounts are not forgotten.
29. As the system, I want idempotent day rewrites (same as-of writers as today)
    when a checkpointed window retries a day, so that resume is safe.
30. As a developer, I want schema for checkpoint (and any reclaim metadata) on
    the rewrite queue to be additive and backward compatible with existing
    pending rows, so that in-flight queues survive deploy.

## Implementation Decisions

- **Scope posture:** Harden overnight as-of rewrite drain reliability only. Do
  not add a hollow CPT day scanner, fleet auto-backfill, separate drain cron, or
  force-enable CPT cron via migration.
- **Drain host:** Keep drain inside/after Customer Policy Trend Daily Snapshot
  cron only (not Credit Dashboard Daily Snapshot, not a new job).
- **Ordering:** Always attempt rewrite drain after the today-snapshot step, even
  when today’s write failed (try/finally or equivalent). Surface both failures
  when both fail.
- **Cron result:** If drain throws, or reports hard failures that mean work did
  not complete cleanly, mark the overall CPT cron run failed or partial-failed
  (not success-with-only-a-log). Distinct “skipped for admin backfill” must not
  by itself fail the cron.
- **Stale reclaim:** At the start of drain, reclaim `processing` rows whose
  `updated_at` (or equivalent) is older than 60 minutes back to `pending` before
  claiming new work.
- **Checkpoint / resume:** Persist last completed snapshot day on the queue
  item. Next drain for that item resumes at the next calendar day through
  `to_date`, then marks `done`. Prefer additive column on
  `CreditAsOfRewriteQueue` (for example `checkpoint_date`) over rewriting
  `from_date` in place so coalesce semantics stay clear; if coalesce widens
  `from_date` backward, resume logic must not skip the newly added earlier days
  (reset or min-bound checkpoint appropriately).
- **Admin backfill exclusion:** While `CreditAsOfBackfillJob` for an account is
  `running` or `paused`, overnight drain must not rewrite that account; leave
  the queue row pending for a later night.
- **Writers unchanged:** Continue calling existing CPT and Credit Dashboard
  Daily Snapshot as-of account writers per day; no change to as-of open AR
  formula in this PRD.
- **Cutover:** One-time operator-driven full-history as-of backfill per
  credit-insurance account via existing Billing-tab modal after harden ships; no
  new fleet API.
- **Ops:** Ship checklist + alert if CPT Daily Snapshot cron is inactive or
  misses a night; do not auto-flip `active` in migration.
- **Modules:** Rewrite queue drain service; CPT daily snapshot cron wrapper;
  small schema migration for checkpoint; read of admin backfill status during
  drain; ops alert/checklist notes (no new analyst UI required).
- **Related prerequisite:** Builds on as-of daily snapshot rewrite (queue + CPT
  drain + admin backfill). Portfolio Health remains a consumer of corrected CPT
  history.

## Testing Decisions

- Prefer testing **external behavior** of the drain entrypoint and cron wrapper:
  given queue/backfill rows and injected writer results, assert status
  transitions, resume day, reclaim, skip, and cron success/failure—not internal
  loop structure.
- **Primary seam (preferred):** `drainAsOfRewriteQueue` (and small pure helpers
  for stale reclaim / resume-from-checkpoint). Highest existing seam for queue
  semantics; extend prior art in as-of rewrite queue unit tests.
- **Secondary seam:** Customer Policy Trend Daily Snapshot cron job
  wrapper—assert drain is attempted when today-write throws, and that drain hard
  failure fails/partial-fails the job result. Prefer existing cron wrapper test
  patterns over spinning a real scheduler.
- **Avoid:** New end-to-end cron harness, browser tests, or Portfolio Health UI
  tests for this reliability PRD (Portfolio Health is the beneficiary, not the
  seam).
- Good tests: reclaim of stale `processing`; no reclaim of fresh `processing`;
  checkpoint resume after simulated mid-window stop; skip when backfill
  `running`/`paused`; drain still invoked after today-write failure; drain
  failure flips cron outcome; coalesce + checkpoint interaction when `from_date`
  widens backward.
- Prior art: as-of rewrite queue unit tests; CPT / dashboard snapshot service
  tests; cron wrapper rethrow / step-collector tests.

## Out of Scope

- Continuous scanner for hollow CPT days (null/zero open AR with unexpected
  empty Health).
- Auto full-history as-of backfill on deploy or a fleet “start all accounts”
  control.
- Moving drain to its own cron or dual-running it from the dashboard snapshot
  cron.
- Force-setting CPT cron `active = true` in a migration.
- Changing as-of open AR / Health-family formulas, Portfolio Health KPI
  definitions, or Credit Dashboard Trend chart UI.
- Mid-window checkpoint for the admin full-history backfill job beyond what it
  already has (this PRD checkpoints the **rewrite queue**).
- Instant synchronous historical rewrite on import request.
- Insurance Policy Trend as-of rewrite.
- New analyst-facing freshness banner on Portfolio Health.

## Further Notes

### Decision log (grill-me — this PRD)

- **D1 — What “automatic” means:** Overnight queue drain only; make it
  reliable (no hollow-day scanner; no fleet auto full-history).
- **D2 — Where drain runs:** Keep drain on CPT cron only; harden that job.
- **D3 — Today-write vs drain:** Always attempt drain even if today’s
  snapshot failed.
- **D4 — Drain failure reporting:** Mark CPT cron failed / partial-failed.
- **D5 — Already-broken history:** One-time admin backfill per credit
  account at ship.
- **D6 — Cutover kickoff:** Operator starts each account from Billing-tab
  modal.
- **D7 — Stuck `processing` rows:** Auto-reclaim stale rows to `pending`
  on next drain.
- **D8 — Stale age:** 60 minutes.
- **D9 — Long windows:** Checkpoint last completed day; resume next night.
- **D10 — CPT cron must run:** Ship/ops checklist + alert if inactive /
  missed night (no force-enable migration).
- **D11 — Admin backfill vs drain:** Skip account in drain while backfill
  `running` or `paused`.

### Motivating incident

Mondeo Ltd (credit account): Credit Insurance Dashboard Trend showed open AR for
2026-07-01–08, while Portfolio Health Lowest point showed 0% because CPT AR
fields were empty and the default no-policy add-on made daily Health 0%. Manual
as-of rewrite for those days filled CPT and restored non-zero Lowest point. This
PRD makes the **overnight queue path** trustworthy going forward and uses
**existing admin backfill** for one-time cutover of similar gaps.

### Related work

- Parent capability: `.cursor/plans/as-of-daily-snapshot-rewrite.prd.md`
- Consumer: `.cursor/plans/credit-portfolio-health.prd.md`
- Existing jobs: Customer Policy Trend Daily Snapshot (hosts drain); Credit
  Dashboard Daily Snapshot; admin `CreditAsOfBackfillJob` Billing-tab modal

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under
`.scratch/overnight-asof-rewrite-drain-reliability/`. **Hard blockers** are
recorded in each slice's **Blocked by** header. Implement in dependency order;
start a **fresh session per issue**.

**Overview:**
`.scratch/overnight-asof-rewrite-drain-reliability/OVERVIEW.md`

| # | Title | Waiting on | Stories |
| --- | --- | --- | --- |
| 1 | Queue checkpoint + reclaim | — | 7–8, 16, 18–21, 25, 29–30 |
| 2 | Skip during admin backfill | #1 | 9–10, 22, 27 |
| 3 | CPT cron drain / fail loudly | #1, #2 | 4–6, 17, 25 |
| 4 | Ship cutover + CPT cron ops | #3 | 11–15, 23–24, 28 |

Full paths under
`.scratch/overnight-asof-rewrite-drain-reliability/issues/`:

- `01-rewrite-queue-checkpoint-and-reclaim.md`
- `02-skip-drain-during-admin-backfill.md`
- `03-cpt-cron-drain-always-fail-loudly.md`
- `04-ship-cutover-and-cpt-cron-ops-guardrails.md`

**Status:** `ready-for-agent` on all slices.
