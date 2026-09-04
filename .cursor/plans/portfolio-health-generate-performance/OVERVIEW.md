# Portfolio Health Generate — performance and reliability

Speed up Portfolio Health **Generate** (`CreditAsOfBackfillJob`) by eliminating redundant per-day ledger queries, batching snapshot writes, parallelizing dashboard scopes, caching per-run context, and improving job reliability and UX — without changing product behavior or snapshot correctness.

**PRD:** `.cursor/plans/portfolio-health-generate-performance.prd.md`

**Related:** `.cursor/plans/portfolio-health-generate-snapshots.prd.md` (feature spec), `.cursor/plans/overnight-asof-rewrite-drain-reliability.prd.md` (nightly drain lock)

Vertical slices live in `issues/`. Implement in dependency order; start a **fresh session per issue**.

| # | Title | File | Waiting on |
|---|-------|------|------------|
| 1 | Range ledger preload | `issues/01-range-ledger-preload.md` | — |
| 2 | Batch CPT writes and per-run cache | `issues/02-batch-cpt-and-run-cache.md` | 01 |
| 3 | Parallel dashboard scopes and job tuning | `issues/03-parallel-scopes-and-job-tuning.md` | 02 |
| 4 | Indexes, durable worker, and Generate UX | `issues/04-indexes-worker-ux.md` | 03 |

**Status:** `ready-for-agent` on all slices.
