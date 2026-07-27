---
name: postgres-logs-to-grafana
overview: Ship AWS RDS PostgreSQL server logs into the existing self-hosted Loki via CloudWatch Logs + Grafana lambda-promtail (VPC-private), then add a Grafana Postgres-logs dashboard and FATAL/PANIC + error-rate alerts. Production first, staging as fast-follow.
source: grill-me session (2026-07-15)
clickup_task_url: null
isProject: false
---

# Add Postgres Logs to Grafana

## Problem Statement

The Archaser observability stack (self-hosted Grafana, Loki, Prometheus, Promtail on the production EC2 host) already aggregates **application** logs into Loki through two paths: a direct `LokiTransportService` push and Promtail scraping PM2 stdout/stderr files. Prometheus also exposes coarse PostgreSQL health (connected/not-connected, active connection count via `pg_stat_activity`).

What is **missing** is PostgreSQL **server logs** — errors, slow queries, connection/disconnection events, lock waits, FATAL/PANIC. The production database is **AWS RDS PostgreSQL**, so Promtail cannot mount log files off disk (the existing PM2 pattern does not apply). The existing Grafana `Postgres` datasource only runs SQL against application tables; it does not surface server logs. Without these logs, operators cannot diagnose DB-side failures, connection storms, or slow statements from within Grafana alongside app logs.

## Goal

Make RDS PostgreSQL server logs queryable and alertable in Grafana, unified in Loki with existing application logs — with minimal public exposure and consistent with existing CloudFormation-based AWS infra.

## Decisions (locked via grilling)

| Decision | Choice |
|----------|--------|
| Postgres hosting | **AWS RDS PostgreSQL** |
| Surfacing path | **CloudWatch → Loki** (keep everything unified in Loki, not a separate CloudWatch datasource) |
| CloudWatch→Loki mechanism | **Grafana's official `lambda-promtail`** |
| CloudWatch → Lambda delivery | **Direct CloudWatch Logs subscription filter** (not Kinesis Firehose) |
| Lambda ↔ Loki connectivity | **Lambda inside the VPC → Loki on EC2 private IP:3100**, locked down by security groups (Loki stays off the public internet) |
| Logging content | Errors + `log_min_duration_statement` (slow queries) + `log_connections`/`log_disconnections` + `log_lock_waits` |
| Slow-query threshold | `log_min_duration_statement = 1000ms` (default; adjustable) |
| Log format | **`jsonlog`** (requires Postgres ≥ 15; else fall back to stderr + regex) |
| Loki labels | `job="rds-postgres"`, `environment`, `error_severity` (low cardinality); full detail stays in the JSON line |
| Retention | CloudWatch Logs **3–7 days** (transient relay); Loki keeps its existing **30-day** retention |
| Reboot handling | Any required RDS reboot scheduled in the **next maintenance window / off-hours** |
| Grafana deliverables | Ingestion **+ Postgres logs dashboard + alerts on FATAL/PANIC and error-rate spikes** (routed via existing SNS contact points) |
| IaC | **CloudFormation** stack under `infrastructure/`, matching the existing SNS stack |
| Rollout | **Production first**, then staging reusing the same stack |

## Architecture

```
RDS PostgreSQL (jsonlog)
   │  log export: "postgresql"
   ▼
CloudWatch Logs group: /aws/rds/instance/<id>/postgresql   (retention 3–7 days)
   │  subscription filter
   ▼
lambda-promtail (Lambda, in VPC, private subnets)
   │  HTTP push /loki/api/v1/push  (private IP:3100)
   ▼
Loki on EC2 (existing, 30-day retention)
   │
   ▼
Grafana  ──►  Postgres logs dashboard + alert rules ──► existing SNS contact point ──► email/Slack
```

### Why this shape
- **Loki-unified**: one query language (LogQL) and one UI for app + DB logs; retention controlled in-house.
- **lambda-promtail**: Grafana-maintained, native fit with the existing Promtail/Loki stack; no new runtime (Alloy) to operate.
- **Direct subscription filter**: errors + slow queries only is modest volume; Firehose buffering is unnecessary complexity for now.
- **VPC-private**: Loki has no auth today; keeping the Lambda→Loki hop inside the VPC avoids exposing an unauthenticated log sink to the internet.
- **jsonlog**: structured fields (`error_severity`, `message`, `detail`, `query`, duration) avoid brittle `log_line_prefix` regex parsing.

## Implementation Plan

### Phase 0 — Prerequisites / discovery (must confirm before build)
Gather (from AWS console / user):
- [ ] Production RDS **instance identifier** and **Postgres engine version** (confirm ≥ 15 for `jsonlog`).
- [ ] **VPC ID**, **private subnet IDs** the Lambda will attach to.
- [ ] EC2 (Loki host) **security group ID** and the EC2 **private IP**.
- [ ] Confirm Loki `3100` is reachable on the instance's private interface. Compose maps `"3100:3100"` (binds `0.0.0.0`), so it is reachable on the private IP — the security group must allow it from the Lambda SG only, and must **not** open 3100 publicly.
- [ ] Whether the RDS instance uses a **default** parameter group (attaching a custom one requires a reboot) or already a custom one.

### Phase 1 — RDS logging configuration (CloudFormation where possible; parameter group + reboot in maintenance window)
- [ ] Create/attach a **custom DB parameter group** with:
  - `log_destination = 'jsonlog'` (or `'csvlog'`/`'stderr'` fallback if < 15)
  - `rds.log_json` / relevant RDS logging toggles as required by the engine version
  - `log_min_duration_statement = 1000`
  - `log_connections = 1`, `log_disconnections = 1`
  - `log_lock_waits = 1`
  - `log_min_messages = warning`, `log_min_error_statement = error`
  - `log_error_verbosity = default`
- [ ] Enable **CloudWatch Logs export** for `postgresql` on the RDS instance (no reboot).
- [ ] Set CloudWatch log group **retention to 3–7 days**.
- [ ] Schedule the reboot (if required to apply pending-reboot params) in the **next maintenance window**.

> Note: `jsonlog` and its enabling parameters vary by RDS engine version. Verify exact parameter names against the target engine version during Phase 0. If the instance is < 15, fall back to `stderr` with an explicit `log_line_prefix` and add a Loki regex pipeline stage.

### Phase 2 — lambda-promtail + AWS wiring (CloudFormation, under `infrastructure/`)
Create `infrastructure/postgres-logs/` (mirroring `infrastructure/sns/` conventions) with a CloudFormation template defining:
- [ ] **Lambda function** running Grafana's `lambda-promtail` (container image published by Grafana, or zip build), configured via env:
  - `WRITE_ADDRESS = http://<EC2_PRIVATE_IP>:3100/loki/api/v1/push`
  - extra static labels: `job=rds-postgres`, `environment=production`
  - `KEEP_STREAM` / `EXTRA_LABELS` as needed for `error_severity` extraction
- [ ] **VPC config** on the Lambda: private subnets + a dedicated Lambda **security group**.
- [ ] **Security group rule**: allow Lambda SG → EC2 (Loki) SG on TCP **3100** only.
- [ ] **IAM execution role**: `AWSLambdaVPCAccessExecutionRole` (ENI mgmt) + CloudWatch Logs read for the source group.
- [ ] **CloudWatch Logs subscription filter** on `/aws/rds/instance/<id>/postgresql` → the Lambda (with the required `lambda:InvokeFunction` permission for `logs.amazonaws.com`).
- [ ] Parameterize instance id, VPC/subnets/SGs, and Loki endpoint as CloudFormation parameters so the same template redeploys for staging.

### Phase 3 — Loki label / parsing shape
- [ ] Ensure `error_severity` becomes a **label** (low cardinality: DEBUG/INFO/NOTICE/WARNING/ERROR/FATAL/PANIC), keeping `message`, `detail`, `query`, `duration`, `backend`, etc. in the JSON line (queried via LogQL `json` parser).
- [ ] Decide extraction point: prefer lambda-promtail `EXTRA_LABELS`/relabel or a small pipeline; avoid promoting high-cardinality fields (query text, session id) to labels.
- [ ] No change to existing `promtail-config.yaml` / PM2 path — this is an independent stream.

### Phase 4 — Grafana dashboard + alerts (provisioned files)
- [ ] Add a **Postgres logs dashboard** JSON under `grafana/provisioning/dashboards/production/` (and later `staging/`): panels for log volume by `error_severity`, FATAL/PANIC feed, slow-query feed (from `duration`), connection/disconnection rate, top error messages.
- [ ] Add **alert rules** to `grafana/provisioning/alerting/rules-production.yaml`:
  - FATAL/PANIC occurrence (any in a short window)
  - Error-rate spike (`error_severity=ERROR` count over threshold in window)
- [ ] Route through existing `contact-points.yaml` → SNS webhook → SES/Slack; keep staging muted per existing `notification-policies.yaml`.

### Phase 5 — Rollout & validation
- [ ] Deploy CloudFormation to production; confirm the subscription filter is invoking the Lambda (CloudWatch metrics) and Loki is receiving `{job="rds-postgres"}` streams.
- [ ] Validate in Grafana Explore: `{job="rds-postgres", environment="production"} | json`.
- [ ] Trigger a benign test (e.g., a slow query > threshold, an intentional error) and confirm it lands with correct `error_severity` label.
- [ ] Verify alerts fire and route correctly.
- [ ] **Staging fast-follow**: redeploy the same CloudFormation with staging parameters; add staging dashboard/rules.

## Codebase scan

**Required changes / additions**
- `infrastructure/postgres-logs/` (new) — CloudFormation template + README for lambda-promtail, IAM, subscription filter, SG rule, VPC config. Mirror `infrastructure/sns/`.
- `grafana/provisioning/dashboards/production/` (+ `staging/`) — new Postgres logs dashboard JSON.
- `grafana-dashboards.yml` — no change expected (folder is already mounted), but confirm the new dashboard file is picked up by the provider glob.
- `grafana/provisioning/alerting/rules-production.yaml` (+ `rules-staging.yaml`) — add FATAL/PANIC + error-rate alert rules.

**No change needed (verified)**
- `promtail-config.yaml` — PM2 file scrape only; RDS logs arrive via Lambda, not Promtail. Independent stream.
- `loki-config.yaml` — reuse existing 30-day retention; no per-stream retention needed given the chosen retention decision.
- `grafana-datasources.yml` — existing `Loki` datasource is the target; the SQL `Postgres` datasource is unrelated and unchanged.
- `docker-compose.logging.yml` — Loki `3100:3100` mapping already exposes on the private interface; no compose change (network lockdown is via AWS security groups). Confirm SG hygiene rather than editing compose.
- `lib/metrics.ts`, `lib/metricsUpdater.ts`, `pages/api/metrics.ts` — Prometheus DB metrics stay as-is; this effort is logs, not metrics.
- `prometheus.yml` — unchanged.

**Optional / out of scope unless requested**
- `postgres_exporter` / `pg_stat_statements` for richer DB **metrics** (separate from logs).
- Loki **authentication** and remote (S3) storage hardening — recommended follow-up, larger scope.
- Fixing the silent-failure behavior of `LokiTransportService` (1s timeout, swallowed errors) — pre-existing, unrelated.
- Staging label bug in `promtail-config.yaml` (`environment` hard-coded `production`) — pre-existing app-log issue, not part of DB logs.
- Documentation refresh for stale infra docs (Grafana port 3001→3002, Amplify vs EC2) — out of scope.

## Risks & Assumptions

- **Postgres version < 15**: `jsonlog` unavailable → fall back to `stderr` + `log_line_prefix` + Loki regex parsing. Confirm version in Phase 0.
- **RDS reboot**: attaching a custom parameter group (from default) or applying pending-reboot params needs a reboot → deferred to maintenance window (accepted).
- **Lambda-in-VPC egress**: a VPC Lambda loses default internet access; acceptable because it only needs the private Loki endpoint. If the Lambda later needs AWS API calls without a route, add VPC endpoints / NAT (not required for the Loki push path).
- **Unauthenticated Loki**: mitigated by keeping the hop VPC-private and SG-restricted to the Lambda SG on 3100 only. Public exposure explicitly avoided.
- **Log volume/PII**: `log_statement=all` deliberately **not** enabled; slow-query logging can still capture statement text — acceptable at ERROR/slow scope, revisit if statements contain sensitive literals.
- **Cost**: CloudWatch retention kept short (3–7 days) since Loki is the durable store.
- **Hosting assumption**: plan assumes RDS per grilling. If the DB is ever moved on-host, the ingestion path would switch to a Promtail file/journald scrape instead.

## Out of scope
- DB **metrics** exporters (postgres_exporter, pg_stat_statements dashboards).
- Loki auth/S3 hardening.
- Refactoring existing app-log transport or fixing unrelated pre-existing issues.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Add Postgres Logs to Grafana](https://app.clickup.com/t/869e42y3m)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | RDS PostgreSQL logging + CloudWatch export (production) | [869e4zghx](https://app.clickup.com/t/869e4zghx) | — | 4, 5, 6, 16, 19, 27, 39, 40 |
| 2 | lambda-promtail CloudWatch→Loki pipeline (production) | [869e4zgj8](https://app.clickup.com/t/869e4zgj8) | 1 | 1, 7, 12–15, 17–18, 25, 31, 34–36 |
| 3 | Grafana Postgres logs dashboard + production alerts | [869e4zgm4](https://app.clickup.com/t/869e4zgm4) | 2 | 2, 3, 7–9, 24, 28, 33, 37 |
| 4 | Staging Postgres logs fast-follow | [869e4zgmx](https://app.clickup.com/t/869e4zgmx) | 3 | 10, 11, 26, 38 |

**Assignee / status:** Nilotpal Bose; Selected for Development
