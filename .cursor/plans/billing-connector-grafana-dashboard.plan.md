# Billing Connector Grafana Dashboard (Staging First)

**Status:** Ready for implementation  
**Slug:** `billing-connector-grafana-dashboard`  
**Related:** [erp_billing_connector_22321e7a.plan.md](./erp_billing_connector_22321e7a.plan.md) (observability section), [sync-history-mongo.plan.md](../../frontend/.cursor/plans/sync-history-mongo.plan.md)

## Overview

Ship a dedicated Grafana domain dashboard for ERP billing-connector **logs + run history + full metrics** on **staging first**. Mongo `connector_sync_executions` remains the app source of truth; Grafana history comes from **Prometheus finish counters/histograms** and **structured Loki finish lines** (not a Mongo datasource).

This plan supersedes the ERP plan’s “pilot = minimal dashboard” for *this* slice: we implement the fuller observability surface on staging (alerts 1–11, rich panels), then copy to production later.

## Decision log (grill-me)

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Dashboard v1 focus | Full board — logs + run history + full metrics | Nest emit + structured logs required |
| D2 | History in Grafana | Emit metrics + Loki on finish; Mongo stays app SoT | No Mongo Grafana DS |
| D3 | Emit sites | Shared helper on every `runInProcessSync` path | API + connectors + cron/worker |
| D4 | Prometheus series | Same metric names on API, connectors, worker; Grafana `sum()` | Multi-scrape |
| D5 | Loki ingest | JSON lines on Nest stdout + existing Promtail | Filter `compose_service` + `source` in JSON |
| D6 | Environments | Staging first, then production | Soak before prod copy |
| D7 | Staging alerts | Full P0+P1 set | Broader than current prod (rules 1–2 only) |
| D8 | Alert inventory | Plan rules **1–11** on staging | New gauges + `import_jobs_stuck{source}` |
| D9 | Sibling surfaces | Board + **nav link** on all staging dashboards | Home tiles / Alert Drilldown deferred |
| D10 | Gauges vs counters | Gauges: **API MetricsUpdater only**; counters on every sync process | Avoid 3× gauge sums |
| D11 | Panels | MVP + history + P1 extras (p95, per-entity, `$account_id`) | Larger board |
| D12 | Loki verbosity | Start + finish (+ errors) only; finish carries `entity_stats` | Progress stays plain Nest logs |
| D13 | `$account_id` | Free-text variable → Loki only | Never a Prometheus label |

## Discovery gates

| Gate | Blocking? | If Yes | If No |
|------|-----------|--------|-------|
| Mongo collection name for stale RUNNING | Yes (alert 6) | Use `connector_sync_executions` | Fix MetricsUpdater (today: `connectorsyncexecutions`) |
| `error_type` taxonomy on finish/errors | Yes (alerts 1, 8, 9) | Map auth / rate_limit / 5xx / import_validation | Define mapping in shared helper |
| Worker + connectors `/metrics` registries | Informational | Both already have `prom-client` Registry | Wire billing counters into those registries |

## Non-goals (this slice)

- Mongo datasource in Grafana
- Production dashboard / production alert parity copy (follow-up after soak)
- Home / Glance summary tiles
- Alert Drilldown connector rows
- Admin health API / system-health UI
- Changing in-app sync-history UI (already exists)

---

## Architecture

```text
runInProcessSync (shared package)
  ├─ onStart  → JSON stdout (source=billing_connector.sync, status=RUNNING)
  ├─ onError  → JSON stdout + errors_total{error_type}
  └─ onFinish → JSON stdout + sync_total + duration + records_processed
         │
         ▼
  Nest Logger → container stdout → Promtail → Loki
         │
         ▼
  prom-client counters on API / connectors / worker  → Prometheus scrape
         │
  API MetricsUpdater gauges (Postgres + Mongo)       → Prometheus (API job only)
         │
         ▼
  Grafana: archaser-billing-connector-staging
```

### Prometheus query conventions

- **Counters / histograms:** `sum(... )` across scrapes, filter `instance="Staging"`; optionally `nest_service` when needed.
- **Gauges:** scope to API scrape only, e.g. `job="archaser-api"` or `nest_service="archaser-api"` + `instance="Staging"`. Never `sum` the same gauge from three jobs.

### Loki query conventions

- Base: `{job="nest-docker", environment="staging", compose_service=~"api|connectors|worker"} |= "billing_connector.sync" | json`
- Or after JSON parse: `| json | source="billing_connector.sync"`
- `$account_id` (textbox): when non-empty, append `| account_id="$account_id"`

### Required JSON fields (start / finish / error lines)

`source`, `account_id`, `connector_id`, `provider`, `sync_mode`, `trigger`, `status`, `error_type` (nullable), `correlation_id`, `sync_execution_id` / `execution_id`, `entity_type` (optional on start; on finish may be omitted if `entity_stats` present), plus finish-only: `duration_seconds`, `entity_stats` (flattened or stringified JSON).

Do **not** promote `account_id` to a Prometheus or high-cardinality Loki **stream** label.

---

## Phases

### Phase 1 — Shared emit + counters on all sync hosts

1. Add observability hooks in `@archaser/billing-connector` around `runInProcessSync` (injectable `onLog` / `onMetrics` or default stdout JSON + optional metrics callbacks).
2. Register **identical** counter/histogram metric names on:
   - `api` (`createArchaserBusinessMetrics` — already defined)
   - `connectors` (extend connectors Registry)
   - `worker` (extend worker Registry used for cron)
3. Wire callbacks at each call site so finishes always emit:
   - `api/src/billing-connector/billing-connector.service.ts`
   - `connectors/src/accounts/accounts-nested.service.ts`
   - `connectors/src/sync/sync-queue.service.ts`
   - `connectors/src/internal/internal-connectors.controller.ts`
   - cron path via `syncDueBillingConnectors` / worker handler (`packages/cron-jobs` → worker)
4. Define `error_type` mapping from thrown/ERP errors.

### Phase 2 — API gauges + MetricsUpdater for alerts 1–11

1. Fix stale RUNNING query collection → `connector_sync_executions`.
2. Add missing gauges:
   - `archaser_billing_connector_stale_incremental_count`
   - `archaser_billing_connector_sync_enabled_unmapped_count`
3. Extend `archaser_import_jobs_stuck` with `source` label including `billing_connector` (and keep existing behavior for file imports).
4. Cache TTL for billing gauge block (plan default 60s) if scrape cost is high.
5. Ensure checkpoint gauge semantics match alert 5 (backfill stall).

### Phase 3 — Staging dashboard + nav

1. Create `grafana/provisioning/dashboards/staging/archaser-billing-connector-staging.json`
   - UID suggestion: `archaser-billing-connector-stag`
   - Variable: `$account_id` (textbox)
2. Panels (D11):
   - Connectors in error (gauge)
   - Sync failures 24h
   - Errors by `error_type`
   - Incremental vs backfill by status
   - Checkpoint age
   - Duration p95 by provider / sync_mode
   - Records processed by entity_type / result
   - Recent finish / error Loki “history”
   - Recent errors Loki
   - Optional: start lines / RUNNING visibility
3. Add **Billing Connector** link to the shared nav markdown on all staging dashboards (same list pattern as Postgres Logs).

### Phase 4 — Staging alert rules 1–11

Add to `grafana/provisioning/alerting/rules-staging.yaml` with `instance="Staging"`, folder Staging, silent receiver (existing staging pattern). Mirror expressions from ERP plan alerts 1–11 (auth, in-error, no incremental success 24h, incremental failed/timeout, backfill stale, stale RUNNING, incremental PARTIAL, rate_limit/5xx, import_validation spike, import jobs stuck, sync enabled unmapped).

Annotations: link to `/d/archaser-billing-connector-stag/...` and short runbook hints.

### Phase 5 — Follow-up (out of scope unless requested)

- Copy dashboard + alerts to production
- Home tiles + Alert Drilldown rows
- Health API / system-health

---

## Alert inventory (staging)

| # | Title | Primary signal |
|---|--------|----------------|
| 1 | Auth failures | `errors_total{error_type="auth"}` |
| 2 | Connectors in error | `connectors_in_error` |
| 3 | No incremental success 24h | `stale_incremental_count` (**new**) |
| 4 | Incremental FAILED/TIMEOUT | `sync_total{sync_mode="INCREMENTAL",status=~"FAILED\|TIMEOUT"}` |
| 5 | Backfill checkpoint stale | `time() - last_checkpoint_timestamp` |
| 6 | Stale RUNNING | `stale_running_count` (**fix collection**) |
| 7 | Incremental PARTIAL storm | `sync_total{… status="PARTIAL"}` |
| 8 | rate_limit / 5xx | `errors_total{error_type=~"rate_limit\|5xx"}` |
| 9 | import_validation spike | `errors_total{error_type="import_validation"}` |
| 10 | Import jobs stuck | `import_jobs_stuck{source="billing_connector"}` (**extend**) |
| 11 | Sync enabled unmapped | `sync_enabled_unmapped_count` (**new**) |

---

## Codebase scan

### Required

| Area | Path / note |
|------|-------------|
| Sync core | `packages/billing-connector/src/sync/runInProcessSync.ts` — emit hooks |
| Sync due / cron | `packages/billing-connector/src/services/syncDueBillingConnectors.ts`, `packages/cron-jobs/src/handlers.ts`, `worker/src/main.ts` metrics registry |
| API sync | `api/src/billing-connector/billing-connector.service.ts` |
| Connectors sync | `connectors/src/accounts/accounts-nested.service.ts`, `connectors/src/sync/sync-queue.service.ts`, `connectors/src/internal/internal-connectors.controller.ts`, `connectors/src/app.module.ts` Registry |
| Metrics defs | `api/src/metrics/archaser-business-metrics.ts` — add missing gauges; mirror defs on worker/connectors |
| Metrics updater | `api/src/metrics/metrics-updater.service.ts` — fix Mongo collection; add gauges 3/11; import stuck `source` |
| Staging dashboard | **new** `grafana/provisioning/dashboards/staging/archaser-billing-connector-staging.json` |
| Staging nav | All `grafana/provisioning/dashboards/staging/*.json` text nav panels |
| Staging alerts | `grafana/provisioning/alerting/rules-staging.yaml` |
| Sync history model | `packages/billing-connector/src/syncHistory/*` — align field names with Loki JSON (`execution_id`) |

### Optional / out of scope

| Area | Reason |
|------|--------|
| Production dashboard / `rules-production.yaml` extras 3–11 | D6 — after soak |
| `archaser-unified-staging.json` tiles | D9 deferred |
| `archaser-alert-drilldown-staging.json` rows | D9 deferred |
| Frontend billing UI / `sync-history` API | Already exists; Mongo SoT |
| Promtail config | Stdout already scraped for `connectors` |
| Translations / styling | Grafana JSON only |

### No change needed

| Area | Reason |
|------|--------|
| Prisma schema | Gauges read existing `BillingConnector` / `ConnectorSyncState` |
| RDS / lambda-promtail | Unrelated (Postgres server logs) |
| CORS / Amplify | Unrelated |

### Easy-to-miss touchpoints

- Worker cron finish path must register **and** scrape the same counter names (Prometheus already has `archaser-worker` job).
- Connectors peel metrics endpoint must include new series (not only default Node metrics).
- Grafana gauge panels/alerts must **not** `sum` gauges across `nest_service`.
- Finish Loki line must be valid single-line JSON Nest can log without breaking multiline Promtail (prefer one-line JSON).
- `PARTIAL` + `BACKFILL` must not page like incremental failures (alert 4/7 mode-aware).
- Nav string must stay **consistent** across all staging boards (include Billing Connector).

---

## Testing strategy

| Unit | Requirement | How to verify |
|------|-------------|---------------|
| T1 | Finish on API increments `sync_total` | Manual sync → Prometheus `api` scrape |
| T2 | Finish on connectors/worker increments same series | Scheduled or queue sync → `sum` increases |
| T3 | Start/finish JSON in Loki | Explore: `source="billing_connector.sync"` \| json |
| T4 | `$account_id` filters Loki panels | Set variable → only that account |
| T5 | Gauges not triple-counted | One Error connector → gauge `1` on API job |
| T6 | Stale RUNNING uses correct collection | Force stale doc → alert 6 / gauge |
| T7 | Staging nav lists Billing Connector | Every staging dashboard top nav |
| T8 | Alerts 1–11 provision | Grafana Alerting → Staging folder; silent |
| T9 | Dashboard panels populate | Staging board after sample SUCCESS/FAILED |

Tests: add/adjust unit tests only if explicitly requested; prefer staging soak with real sync.

## How to test (staging ops)

1. Deploy Nest (API, connectors, worker) with emit changes; reload Grafana provisioning.
2. Run a manual sync and wait for a scheduled sync.
3. Open **Billing Connector** board — metrics, p95, entity counts, Loki history.
4. Filter `$account_id` for a known account.
5. Confirm Staging alerts exist (silent) and expressions reference `instance="Staging"`.

## Implementation todos

- [ ] Phase 1: shared emit + counters on API/connectors/worker
- [ ] Phase 2: MetricsUpdater gauges + collection fix + import stuck source
- [ ] Phase 3: staging dashboard JSON + nav links
- [ ] Phase 4: staging alert rules 1–11
- [ ] Document production copy as follow-up (Phase 5)
