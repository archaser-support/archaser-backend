---
name: portfolio-health-generate-performance
overview: Speed up Portfolio Health Generate (CreditAsOfBackfillJob) by eliminating redundant per-day ledger queries, batching snapshot writes, parallelizing dashboard scopes, caching per-run context, and improving job reliability and UX — without changing product behavior or snapshot correctness.
source: in-chat analysis of Generate button flow and bottlenecks
clickup_task_url: https://app.clickup.com/t/869evjty0
isProject: false
---

# Portfolio Health Generate — performance and reliability

## Problem Statement

Portfolio Health **Generate** rebuilds daily snapshot history for the selected date range by running `CreditAsOfBackfillJob`: for each UTC day in order, it loads open accounts receivable (AR) as of that day, writes `CustomerPolicyTrend` rows, then writes `CreditDashboardDailySnapshot` rows for every policy and business-unit scope. The default range is 30 days; the maximum is 366.

Analysts wait a long time for progress to move, especially on accounts with many customers, policies, and business units. The job is CPU- and database-heavy because it repeats the same expensive work on every day: a full invoice-and-payment ledger query, hundreds of per-customer upserts, and sequential dashboard summary calculations multiplied by policy and business-unit scopes. Per-day overhead (pause checks, tolerance lookups, capacity-gap maintenance) adds further cost. The runner executes in-process on the API server, so a restart can interrupt work and the job competes with live traffic.

The product behavior of Generate is correct (true as-of history, checkpoint/resume, ignore-reporting-breach overlay, same writers as nightly cron). The problem is **throughput and operability**, not correctness of the existing feature spec in `portfolio-health-generate-snapshots`.

## Solution

Keep the existing Generate UX and job contract (start / pause / retry / status poll, one job per account, sequential day order). Optimize **how each day is computed and persisted** and **how the job runs**, in phased deliverables:

1. **Single ledger preload per job** — Load invoice and payment data once for the full `to_date` window; derive each day's as-of open AR in memory instead of re-querying the database per day.
2. **Batch CustomerPolicyTrend writes** — Replace one upsert round-trip per customer-policy with chunked multi-row upserts.
3. **Per-run context cache** — Resolve account-static inputs once (paid tolerance, currency, policy list, business units, top-up presence, MEP breach start date, snapshot scope list) and pass them through the day loop.
4. **Parallel dashboard scope processing** — Within each day, compute and upsert dashboard snapshots for scopes with bounded concurrency while sharing the same preloaded as-of lines.
5. **Reduce auxiliary per-day N+1 work** — Bulk-fetch predecessor cost fallbacks; batch effective-approved-limit resolution for top-up customers; run capacity-gap ensure once at job start (or skip during historical replay when safe).
6. **Throttled checkpoint updates** — Update `days_done` / `checkpoint_date` on a time or day-interval cadence so progress remains visible without writing after every day.
7. **Database index audit** — Verify and add indexes supporting the ledger aggregation query if missing.
8. **Dedicated job worker (follow-up phase)** — Move the runner off the API process into a durable queue/worker for survival across deploys and isolated compute.
9. **UX expectations** — Optional pre-start estimate and a warning when the selected range is large; no change to max range unless product asks.

Correctness constraints: day order stays sequential (daily cost deltas depend on the prior day's trend row); both snapshot tables continue to be written; ignore-reporting-breach semantics unchanged; nightly drain still skips accounts while Generate is running or paused.

## User Stories

1. As a credit analyst, I want Generate to finish a 30-day default range in noticeably less time, so that I can refresh Portfolio Health after an import without a long wait.
2. As a credit analyst, I want Generate on a 90- or 180-day range to complete in reasonable wall-clock time, so that I can rebuild a quarter or half-year without running overnight manually.
3. As a credit analyst, I want the progress bar to keep advancing smoothly during Generate, so that I know the job is still working.
4. As a credit analyst, I want charts after Generate to show the same numbers as before the optimization for the same inputs, so that faster runs do not change analytics meaning.
5. As a credit analyst, I want Stop, Retry, and ignore-reporting-breach behavior to remain unchanged, so that my workflow is not disrupted.
6. As a credit analyst, I want Generate to resume from checkpoint after a failure, so that partial progress is not lost when something fails mid-range.
7. As a credit analyst, I want to see a rough time estimate or a warning before starting a very large range, so that I can choose a shorter range first if needed.
8. As a credit manager with many business units, I want Generate not to scale linearly with BU count as badly as today, so that large org structures remain usable.
9. As a credit manager with many insurance policies, I want dashboard snapshot writes during Generate to complete faster, so that policy-scoped history appears sooner.
10. As an ARchaser admin, I want Generate to survive API restarts or deploys without silently dying, so that long backfills complete reliably.
11. As an operations engineer, I want Generate jobs to run on dedicated worker capacity, so that analyst-triggered backfills do not slow interactive API latency.
12. As an operations engineer, I want slow ledger queries to be index-backed, so that database load stays predictable under Generate.
13. As a developer, I want one shared as-of ledger path for Generate, nightly cron, and tests, so that optimizations do not fork business logic.
14. As a developer, I want the backfill runner to accept injected loaders and writers in tests, so that performance changes are verifiable without full database fixtures.
15. As a QA engineer, I want automated tests proving in-memory day filtering matches per-day SQL loading for representative invoices and payments, so that the ledger preload refactor cannot drift.
16. As a QA engineer, I want tests that batched CPT upserts produce identical row content to the current per-row upserts, so that batching is a persistence optimization only.
17. As a QA engineer, I want job tests to confirm checkpoint throttling still advances `days_done` monotonically and pause is honored between days, so that UX and safety are preserved.
18. As a credit analyst, I want Generate to still write both CustomerPolicyTrend and CreditDashboardDailySnapshot, so that Portfolio Health and the credit dashboard stay aligned.
19. As a credit analyst, I want ignore reporting breach (default on) to apply the same way after optimization, so that reporting-late overlay behavior is unchanged.
20. As the system, I want nightly as-of rewrite drain to keep skipping accounts while Generate is running or paused, so that two writers never race the same days.
21. As the system, I want MEP breach start date resolved once per Generate run, so that connector reads are not repeated unnecessarily per day.
22. As the system, I want invoice paid tolerance resolved once per Generate run, so that connector reads are not repeated per day.
23. As the system, I want capacity-gap stored values refreshed at most once per Generate run when safe, so that per-day ensure loops do not dominate runtime.
24. As a developer, I want predecessor daily cost logic to bulk-load missing prior-day fallbacks, so that first-day-in-range and sparse history do not trigger hundreds of extra queries.
25. As a developer, I want effective-approved-limit resolution batched for top-up customers, so that per-customer resolver calls inside the CPT loop are eliminated.
26. As a credit analyst on an account without top-ups, I want Generate to benefit from skipped or reduced top-up work, so that simple accounts stay fast.
27. As an operations engineer, I want metrics or logs for per-day duration and scope counts during Generate, so that regressions are visible in production.
28. As a product owner, I want performance work scoped so nightly cron paths reuse the same optimized writers where applicable, so that cron and Generate both improve.
29. As a credit analyst, I want leaving and returning to Portfolio Health to still show accurate job status, so that polling behavior is unchanged.
30. As a developer, I want parallel dashboard scope work limited by a configurable concurrency cap, so that database connection pools are not exhausted.

## Implementation Decisions

### Primary seam (testing and behavior)

The **highest existing seam** is `runCreditAsOfBackfillJob` in the credit-insurance API domain layer, which already accepts injected `loadAsOfLines`, `writers`, and database client. Performance work should extend this runner with a **job-scoped context object** built once at start and passed into each day's writers, rather than introducing a second backfill code path.

Nightly cron and admin backfill should call the **same optimized writers** once landed, so CustomerPolicyTrend and CreditDashboardDailySnapshot stay single-sourced.

### Phase 1 — Ledger preload and in-memory day derivation (highest impact)

- Add a **range loader** that fetches all invoice candidates with `invoice_date` on or before job `to_date`, plus payment aggregates keyed by invoice (or pre-joined rows), in **one or two queries** instead of one heavy query per day.
- Add a **pure function** (or small module) that, given preloaded rows and a `snapshotDate`, returns the same `AsOfOpenInvoiceLine[]` shape that `loadAsOfOpenInvoiceCandidates` returns today — including open-amount tolerance, status filtering, and payment cutoffs at end of that UTC day.
- Wire Generate's runner to call the range loader once, then pass a day-filtering function into the existing `loadAsOfLines` injection point for each day.
- **Do not** parallelize days: daily cost on CustomerPolicyTrend still requires the prior calendar day's row.

### Phase 2 — Batch CustomerPolicyTrend persistence

- Refactor the per-customer loop inside the account CPT sync writer to **accumulate rows** and flush with chunked `INSERT … ON CONFLICT DO UPDATE` (chunk size tunable, e.g. 100–500 rows).
- Preserve column sets and conflict keys exactly; batching is a transport optimization only.
- Keep per-customer computation order deterministic so predecessor and cost logic are unchanged.

### Phase 3 — Per-run context cache

Build once when the job starts (or on first day) and thread through CPT and dashboard writers:

- Invoice paid tolerance
- Account currency
- Active customer policies for the account (or the same query shape used today)
- `hasTopUpPolicies` flag
- MEP breach start date (already resolved once in the runner; extend to tolerance and other static reads)
- Snapshot scope list (account-wide + per-policy; business unit ids)
- Optional: active top-up rows for the account through `to_date` for batch limit resolution

### Phase 4 — Dashboard snapshot parallelism

- Within `processDashboardSnapshotsForAccount`, after as-of lines are ready for the day, run scope summary + upsert with **bounded concurrency** (default cap e.g. 4–8, env-configurable).
- Scopes must share the same `asOfLines` and ignore-reporting-breach overlay; only summary computation and upsert may run in parallel.
- Preserve scope ordering in logs/metrics if useful for debugging; result rows must match current upsert semantics.

### Phase 5 — Auxiliary query reductions

- **Predecessor fallbacks:** Before the per-customer CPT loop each day, bulk-query any missing `(customer_id, insurance_policy_id)` predecessor rows needed for daily cost delta instead of per-customer `findFallbackPredecessorTrendRow` calls.
- **Effective approved limit:** For accounts with top-ups, resolve limits for all relevant customers in one batched path (single query for top-up rows + in-memory grouping) instead of await-per-customer inside the loop.
- **Capacity gap ensure:** Run `ensureCustomerCapacityGapStored` once per distinct customer at job start (concurrency 25 as today), or skip during historical backfill if gap stored values are not date-dependent for replay — confirm against gap pipeline semantics before skipping entirely.

### Phase 6 — Checkpoint throttling

- Update `CreditAsOfBackfillJob` checkpoint fields on a **minimum interval** (e.g. every 5 seconds or every N days, whichever comes first) while still checking pause status each day (lightweight status read).
- On failure or completion, always flush final checkpoint immediately.
- Frontend polling at 2s remains valid; progress may jump in small steps.

### Phase 7 — Database indexes (audit + migration if needed)

- Verify indexes supporting:
  - Invoice filter by account and invoice date
  - InvoicePayment filter by invoice, account, and payment date (for as-of aggregation)
  - CustomerPolicyTrend lookup by account and snapshot date (prior-day read)
- Add migrations only where EXPLAIN or production evidence shows sequential scans; document expected query plans in Further Notes.

### Phase 8 — Durable worker (structural, separate slice)

- Replace in-process `kickRunner` fire-and-forget with a **queue-backed worker** (existing cron/worker patterns in the repo preferred).
- Job row remains source of truth for status; worker claims `running` jobs, executes the same `runCreditAsOfBackfillJob`, handles process crash by leaving job resumable.
- API start/pause/retry endpoints enqueue or signal worker; no long HTTP hold.
- Out of initial performance PR implementation unless explicitly pulled forward — listed here for completeness.

### Phase 9 — UX (frontend, low risk)

- Before start: if `daysInRange` exceeds a threshold (e.g. 90), show non-blocking confirmation or helper text with expected duration band (derived from last completed job duration per day if available, else static guidance).
- Optional: display last-run seconds-per-day from job metadata if backend stores it on complete.
- Reuse existing LinearProgress; no new styles without approval.

### API and schema

- **No breaking API changes** to `asof-backfill-start`, `asof-backfill-status`, `asof-backfill-pause`, `asof-backfill-retry`.
- Optional additive fields on status response: `avgSecondsPerDay`, `estimatedSecondsRemaining` — only if cheap to persist.
- **No schema change required** for Phases 1–7 unless index migrations are added.

### Correctness guards

- Golden/fixture tests must compare optimized vs baseline outputs for the same account fixture across multiple days.
- Nightly cron paths that call the same writers get the same tests indirectly; spot-check one cron entrypoint after writer refactor.
- Ignore-reporting-breach overlay applies after lines are derived for each day, same as today.

### Optional future decision (not default)

- **CPT-only Generate mode** that skips CreditDashboardDailySnapshot writes would roughly halve per-day work but desynchronizes dashboard trend tables until nightly cron runs. **Out of scope** unless product explicitly opts in.

## Testing Decisions

**What makes a good test:** Assert **observable outcomes** — snapshot row payloads, open AR totals per customer/day, job checkpoint progression, pause/resume behavior — not SQL text, chunk sizes, or concurrency constants.

**Primary seam:** `runCreditAsOfBackfillJob` with injected `loadAsOfLines` and writers (existing pattern in credit-asof-backfill job tests). Extend with fixtures that prove optimized loaders produce identical day inputs to the legacy per-day loader.

**Secondary seams (pure functions, highest possible):**

- In-memory as-of line derivation from preloaded ledger fixtures (mirror of range loader output per day).
- Batch upsert row builder: given the same computed row objects, batched persistence matches single-row upsert results (integration or transactional test DB).

**Modules to test:**

- Range ledger loader + day filter pure logic (new unit tests in credit-insurance domain package).
- CPT sync writer batch path vs baseline row content (integration or heavy unit with mocked DB capturing SQL batches).
- Dashboard scope processor: same summary metrics with parallel vs sequential execution (mock `getCreditDashboardSummary`).
- Backfill job: checkpoint throttling still monotonic; pause between days honored; retry resumes from checkpoint.
- Regression: ignore-reporting-breach overlay unchanged on sample lines.

**Prior art:**

- `tests/backend/api/credit-asof-backfill-job.test.ts` — job lifecycle, conflict, pause, retry, injected writers.
- `tests/backend/api/credit-portfolio-health-service.test.ts` — portfolio health domain behavior.
- Existing as-of open AR and customer policy trend domain tests in the credit-insurance package (grep for `loadAsOfOpenInvoiceCandidates`, `syncCustomerPolicyTrendSnapshotForAccount`).

**Performance validation (manual / ops, not CI gate initially):**

- Record wall-clock for 30-day Generate on a reference account before and after Phase 1+2.
- Target: meaningful reduction (product sets threshold; engineering proposes 50%+ on ledger-bound accounts as aspirational).

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/portfolio-health-generate-performance/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/portfolio-health-generate-performance/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Range ledger preload | `issues/01-range-ledger-preload.md` | — | 1, 2, 4, 13, 15, 18, 19, 21, 22, 28 |
| 2 | Batch CPT writes and per-run cache | `issues/02-batch-cpt-and-run-cache.md` | 01 | 1, 2, 4, 16, 21, 22, 23, 26, 28 |
| 3 | Parallel dashboard scopes and job tuning | `issues/03-parallel-scopes-and-job-tuning.md` | 02 | 3, 5, 6, 8, 9, 17, 24, 25, 27, 29, 30 |
| 4 | Indexes, durable worker, and Generate UX | `issues/04-indexes-worker-ux.md` | 03 | 7, 10, 11, 12, 27 |

**Status:** slices restored from parked WIP (some may already be `done`); remaining work is `ready-for-agent`.

## Out of Scope

- Changing Generate product rules from `portfolio-health-generate-snapshots` (who can run, which tables, overwrite semantics, ignore-reporting-breach meaning, filter scope on write).
- CPT-only mode unless explicitly requested later.
- Parallel processing across **days** (breaks daily cost predecessor chain).
- Insurance policy trend snapshot backfill.
- Portfolio Health **read path** / chart query optimization (separate from Generate write path).
- Translation file edits unless explicitly permitted at implementation time.
- New global styles; reuse existing progress and button patterns.
- Fleet-wide automatic backfill on deploy (see overnight as-of rewrite reliability PRD).
- ClickUp tasks or vertical slices (use `/to-issues` after PRD approval).

## Further Notes

- **Related PRDs:** `portfolio-health-generate-snapshots` (feature spec), `overnight-asof-rewrite-drain-reliability` (nightly drain vs admin/generate lock), `as-of-daily-snapshot-rewrite` (true-history writer).
- **Bottleneck summary (baseline):** per day ≈ one lateral payment aggregation query + O(customers) CPT upserts + O((1 + policies) × (1 + businessUnits)) sequential dashboard summaries + auxiliary per-customer queries (top-ups, capacity gap, predecessor fallback).
- **Recommended implementation order:** See **Issues (vertical slices)** above.
- **Risk:** In-memory ledger preload must match SQL semantics for edge cases (void/cancelled invoices, tolerance, payment exactly on day boundary, credit notes). Golden tests with paid-after-day and partial-payment invoices are mandatory before shipping Phase 1.
