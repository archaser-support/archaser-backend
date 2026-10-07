# Stuck cron / worker queue backlog → Grafana

**ClickUp:** [add stucked cron to graphana](https://app.clickup.com/t/25708732/869f05yda)  
**Branch:** `feat/stuck-cron-queue-grafana-CU-869f05yda`  
**Status:** ready for implementation

## Problem

Ops need to know when the BullMQ (Bull Message Queue) worker queues are backed up so cron and heavy jobs sit waiting. Today Grafana only infers “stuck” from Postgres `next_run_at` / `last_run_at` (overdue / not-run-24h). There is no queue-depth metric and **no** “skip when queue full” path in the worker.

## Goals

- Export waiting / active / failed job counts for all three worker queues.
- Grafana panels on Cron Health and Alert Drilldown (prod + staging).
- Three production (+ staging silent) alerts on high **waiting** count, sustained 10m.
- SNS (Simple Notification Service) email enrichment via Nest alert-details (counts + ≤10 waiting job samples + runbook).

## Non-goals

- Do **not** skip or reject cron enqueue when the queue is “full”.
- Do **not** alert on waiting age or active+waiting sum.
- Delayed job counts are out of panel scope for MVP (Minimum Viable Product).

## Decisions (grill)

| # | Decision |
|---|----------|
| D1 | Monitoring/alert only — no skip-when-full |
| D2 | All three queues: cron, credit as-of backfill, VAT (Value Added Tax) basis refresh |
| D3 | Signal = waiting job count ≥ N |
| D4–D5 | Per-queue thresholds: cron ≥ 5, backfill ≥ 20, VAT ≥ 10 |
| D6 | `for: 10m` |
| D7 | Three separate Grafana alerts |
| D8 | Prod + staging rules (staging silent outbound) |
| D9 | Panels on Cron Health |
| D10 | Full alert-details enrichment |
| D11 | Panels: waiting + active + failed |
| D12 | Email: counts + ≤10 waiting job names/ids |
| D13 | Matching panels on Alert Drilldown |
| D14 | Ship metrics + panels + enrichment + rules together |

## Design

### Metrics (worker)

Gauges on the worker Prometheus registry (scraped with `instance=Production|Staging`):

- `archaser_bullmq_queue_waiting{queue=...}`
- `archaser_bullmq_queue_active{queue=...}`
- `archaser_bullmq_queue_failed{queue=...}`

Logical `queue` labels (stable across env Redis names):

| Label | Redis queue (typical) |
|-------|----------------------|
| `cron` | `archaser-cron` / `archaser-cron-prod` |
| `credit_asof_backfill` | `archaser-credit-asof-backfill` |
| `account_vat_basis_refresh` | `archaser-account-vat-basis-refresh` |

Updated on an interval via BullMQ `getJobCounts('waiting','active','failed')`.

### Alerts

| UID suffix | Title | Expr threshold | `for` | `alert_details_type` |
|------------|-------|----------------|-------|----------------------|
| `bullmq-cron-queue-waiting-*` | Worker Cron Queue Waiting High | waiting{queue="cron"} > 5 | 10m | `bullmq_cron_queue_backlog` |
| `bullmq-backfill-queue-waiting-*` | Worker Backfill Queue Waiting High | waiting{queue="credit_asof_backfill"} > 20 | 10m | `bullmq_backfill_queue_backlog` |
| `bullmq-vat-queue-waiting-*` | Worker VAT Queue Waiting High | waiting{queue="account_vat_basis_refresh"} > 10 | 10m | `bullmq_vat_queue_backlog` |

### Alert-details

Nest `GET /api/alert-details?type=...` returns counts + up to `limit` waiting job id/name samples + runbook. Implemented via `CronQueueService` (API already holds BullMQ clients).

### Grafana

- Cron Health: new row “Worker queue depth” with timeseries/stat for waiting/active/failed by queue.
- Alert Drilldown: matching Prometheus panels under Cron Jobs section.
- Rules in `rules-production.yaml` and `rules-staging.yaml`.

## How to test

1. Deploy/restart worker; confirm `/metrics` exposes the three gauges with `queue` labels.
2. Staging Grafana Cron Health: panels show values (near zero idle).
3. Temporarily lower staging cron threshold or enqueue many waiting jobs; confirm alert fires in Grafana (no SNS page — silent staging).
4. Call alert-details with API key and each new type; confirm counts + sample jobs + runbook.
5. Production: after deploy, confirm panels; tune thresholds if noisy.

## Codebase scan

### Required

| Area | Files |
|------|--------|
| Worker metrics | `worker/src/main.ts` (+ small helper if extracted) |
| Queue snapshot API | `api/src/queue/cron-queue.service.ts` (also honor `BULLMQ_QUEUE` for prod cron name), `queue.module.ts` |
| Alert enrichment | `api/src/alert-details/alert-details.service.ts`, `.module.ts` |
| SNS Lambda type map | `infrastructure/sns/lambda/resolveAlertType.js` |
| Alert rules | `grafana/provisioning/alerting/rules-{production,staging}.yaml` |
| Dashboards | `grafana/provisioning/dashboards/{production,staging}/archaser-cron-*.json`, `archaser-alert-drilldown-*.json` |

### Optional / out of scope unless requested

- OpenAPI mirror for alert-details types
- Unit tests for snapshot helper
- Delayed/paused BullMQ counts
- FE changes (none)

### No change needed

| Area | Reason |
|------|--------|
| Product user notifications / SES activity email | Unrelated |
| Skip-when-queue-full worker gate | Explicit non-goal |
| Prometheus scrape config | Worker already scraped with `instance` label |
| ClickUp Chat / SNS recipients | Existing pipeline |

## Testing strategy (requirements → checks)

| Requirement | Check |
|-------------|-------|
| Waiting/active/failed exported | Worker `/metrics` scrape |
| Panels visible | Cron Health + Alert Drilldown staging/prod |
| Three alerts | Rule YAML + Grafana alert list |
| Enrichment | alert-details response shape for three types |
| No skip behavior | Code review — no enqueue gate added |
