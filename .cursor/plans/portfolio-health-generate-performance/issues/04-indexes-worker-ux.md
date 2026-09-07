# 04 — Indexes, durable worker, and Generate UX

**Status:** done  
**Priority:** normal  
**Blocked by:** [03-parallel-scopes-and-job-tuning](03-parallel-scopes-and-job-tuning.md)  
**User stories:** 7, 10, 11, 12, 27  
**PRD:** `.cursor/plans/portfolio-health-generate-performance.prd.md`

## What to build

Close the performance and operability loop: database index support, durable job execution off the API process, and analyst-facing expectations on Portfolio Health.

Three parts in one slice (each independently verifiable):

1. **Index audit and migration** — EXPLAIN or schema review for Generate's range ledger query and prior-day CPT reads. Add indexes only where missing (Invoice by account + invoice date; InvoicePayment by invoice, account, payment date; CustomerPolicyTrend by account + snapshot date). Document findings in PRD Further Notes or migration comment.
2. **Durable worker** — Move `CreditAsOfBackfillJob` execution off in-process `kickRunner` to a queue/worker pattern consistent with existing cron workers. Job row remains source of truth; worker claims `running` jobs; API start/pause/retry unchanged; crash leaves job resumable via Retry.
3. **Generate UX** — On Portfolio Health, when selected range exceeds ~90 days, show non-blocking helper text or confirmation before start (static guidance or estimate if backend exposes optional `avgSecondsPerDay` on complete). Reuse existing buttons and LinearProgress; no new styles without approval. Translation keys use English `defaultValue` until translation files are explicitly allowed.

Optional additive API fields on backfill status: `avgSecondsPerDay`, `estimatedSecondsRemaining` — only if cheap to persist on job complete.

## Acceptance criteria

- [ ] Index migration merged only where audit proves benefit; no unnecessary indexes.
- [ ] Generate survives API process restart: job stays `running` or resumable; worker picks up or Retry restarts processing.
- [ ] Start / pause / retry / status poll API contracts unchanged for clients.
- [ ] Large-range warning or estimate visible on Portfolio Health before Generate when range > threshold.
- [ ] End-to-end Generate on a 30-day range is materially faster than pre-optimization baseline (manual benchmark noted in PR).

## How to test

1. **Indexes:** Run Generate on a large account; confirm ledger query uses indexes (EXPLAIN in staging) and acceptable query time.
2. **Worker:** Start a 30+ day Generate, restart API/worker process mid-run, confirm job status still visible on Portfolio Health and processing resumes (worker reclaim or Retry).
3. **UX:** Set from/to to 120+ days — helper text or confirmation appears before Generate; shorter range has no unnecessary warning.
4. **Regression:** Full Generate on 30-day range completes; charts match slice 03 outputs.
5. **API:** Poll `asof-backfill-status` — response shape unchanged except optional new estimate fields.
