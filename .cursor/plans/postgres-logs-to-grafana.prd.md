---
name: postgres-logs-to-grafana
overview: Ship AWS RDS PostgreSQL server logs into the existing self-hosted Loki via CloudWatch Logs and Grafana lambda-promtail (VPC-private), then add a Grafana Postgres-logs dashboard and FATAL/PANIC plus error-rate alerts. Production first, staging as fast-follow.
source: grill-me session (2026-07-15)
clickup_task_url: https://app.clickup.com/t/869e42y3m
isProject: false
---

# Add Postgres Logs to Grafana

## Problem Statement

ARChaser already runs a self-hosted observability stack on the production EC2 host: Grafana, Loki, Prometheus, and Promtail. Application logs reach Loki through structured log transport and PM2 stdout/stderr scraping. Prometheus exposes coarse PostgreSQL health signals (connectivity and active connection counts).

What is missing is **PostgreSQL server logs** — errors, slow queries, connection and disconnection events, lock waits, and FATAL/PANIC events. The production database is **AWS RDS PostgreSQL**, so the existing Promtail file-scrape pattern cannot read database log files from disk. The Grafana SQL Postgres datasource queries application tables; it does not surface server logs. Without these logs, operators cannot diagnose database-side failures, connection storms, or slow statements in the same Grafana/Loki workspace used for application troubleshooting.

## Solution

Enable RDS PostgreSQL logging with a focused, production-safe profile (errors, slow queries, connections/disconnections, lock waits) in **structured JSON format** where supported. Export logs to **CloudWatch Logs** with short retention as a transient relay. Forward them to the existing **Loki** instance using Grafana's **lambda-promtail** Lambda inside the VPC, pushing to Loki on the EC2 host's private address over a security-group-restricted path. Query and alert on the unified log stream in Grafana: a dedicated **Postgres logs dashboard** plus **alerts for FATAL/PANIC and error-rate spikes**, routed through the existing SNS notification path. Provision AWS resources via **CloudFormation** consistent with the existing SNS stack. Roll out to **production first**, then extend to staging by reusing the same template with different parameters.

## User Stories

1. As an **on-call engineer**, I want RDS PostgreSQL server errors visible in Grafana alongside application logs, so that I can correlate database failures with app incidents without switching tools.

2. As an **on-call engineer**, I want FATAL and PANIC database events to trigger alerts quickly, so that I am notified when the database is in a critical failure state.

3. As an **on-call engineer**, I want alerts when PostgreSQL error volume spikes, so that I can catch degrading database health before a full outage.

4. As an **on-call engineer**, I want slow queries above a defined threshold logged and searchable, so that I can investigate performance regressions without enabling full statement logging.

5. As an **on-call engineer**, I want connection and disconnection events logged, so that I can diagnose connection storms or pool exhaustion.

6. As an **on-call engineer**, I want lock-wait events logged, so that I can identify blocking queries and deadlocks.

7. As an **on-call engineer**, I want Postgres logs queryable with LogQL in Grafana Explore using consistent labels, so that filtering by environment and severity is fast and predictable.

8. As an **on-call engineer**, I want a dedicated Grafana dashboard summarizing Postgres log volume, severity breakdown, slow queries, and recent FATAL/PANIC lines, so that I have a single starting point during incidents.

9. As an **on-call engineer**, I want production Postgres alerts delivered through the existing SNS email/Slack path, so that notification behavior matches other infrastructure alerts.

10. As an **on-call engineer**, I want staging Postgres logs ingested with staging labels after production is proven, so that I can debug staging database issues without polluting production views.

11. As an **on-call engineer**, I want staging Postgres alerts to follow existing staging notification policy (visible in Grafana, not paging production channels), so that staging instability does not wake the team.

12. As a **platform engineer**, I want the CloudWatch-to-Loki pipeline provisioned as Infrastructure as Code, so that changes are reviewable in git and repeatable across environments.

13. As a **platform engineer**, I want lambda-promtail to reach Loki over a private VPC path only, so that the unauthenticated Loki endpoint is not exposed to the public internet.

14. As a **platform engineer**, I want CloudWatch log retention kept short, so that relay storage cost stays low while Loki remains the durable store.

15. As a **platform engineer**, I want Loki to retain Postgres logs for the same 30-day window as other logs, so that retention policy stays consistent across the observability stack.

16. As a **platform engineer**, I want RDS parameter changes that require a reboot scheduled in the maintenance window, so that logging enablement does not cause unplanned downtime.

17. As a **platform engineer**, I want low-cardinality Loki labels (`job`, `environment`, `error_severity`), so that Loki performance and query cost remain healthy.

18. As a **platform engineer**, I want query text and session details kept in log line JSON rather than promoted to labels, so that high-cardinality fields do not bloat the index.

19. As a **security-conscious operator**, I want `log_statement=all` avoided, so that routine queries with sensitive literals are not broadly logged.

20. As a **developer**, I want no changes to application code or Prisma connection logic for this feature, so that database log ingestion remains an infrastructure concern.

21. As a **developer**, I want the existing Prometheus PostgreSQL connectivity metrics unchanged, so that current dashboards and alerts continue to work.

22. As a **developer**, I want the existing PM2 Promtail scrape path unchanged, so that application log collection is not regressed.

23. As a **developer**, I want the existing Grafana SQL Postgres datasource unchanged, so that SQL drilldown dashboards keep working independently of server logs.

24. As a **developer deploying monitoring**, I want Grafana dashboard and alert rules provisioned from the repo like today, so that changes apply via the existing Docker Compose logging stack.

25. As an **operator**, I want a documented rollout and validation checklist, so that production deployment can be verified step by step.

26. As an **operator**, I want CloudFormation parameters for RDS instance, VPC subnets, security groups, and Loki endpoint, so that the same stack deploys to staging with different values.

27. As a **platform engineer**, I want a fallback path documented if RDS PostgreSQL is below version 15, so that logging still works using text format and parsing rather than blocking the project.

28. As an **on-call engineer**, I want to filter Postgres logs by `error_severity` in dashboards and alerts, so that I can separate noise from actionable errors.

29. As a **team lead**, I want postgres_exporter and pg_stat_statements work tracked separately, so that log ingestion ships without waiting for metrics expansion.

30. As a **team lead**, I want Loki authentication and S3 remote storage hardening tracked as follow-up, so that this slice stays focused on log visibility.

31. As a **QA engineer**, I want manual validation steps for end-to-end log flow (RDS → CloudWatch → Lambda → Loki → Grafana), so that rollout confidence does not depend solely on console checks.

32. As a **QA engineer**, I want benign test procedures for slow-query and error log generation, so that ingestion and alerting can be verified without harming production data.

33. As an **on-call engineer**, I want alert drilldown or dashboard links in notifications where applicable, so that investigation starts in one click.

34. As a **platform engineer**, I want lambda-promtail IAM permissions scoped to the RDS CloudWatch log group, so that the forwarder follows least privilege.

35. As a **platform engineer**, I want the Lambda security group allowed only to the EC2 Loki port, so that lateral network exposure is minimized.

36. As an **operator**, I want CloudWatch subscription filter invocation metrics observable, so that I can confirm the pipeline is actively forwarding logs.

37. As an **on-call engineer**, I want recent top error messages visible on the dashboard, so that recurring failures are obvious during triage.

38. As a **developer**, I want `MONITORING_ENV` behavior unchanged for Grafana provisioning, so that production and staging monitoring instances continue to mount environment-specific dashboards and rules.

39. As a **platform engineer**, I want jsonlog as the preferred format when the engine supports it, so that severity and duration fields are structured without regex fragility.

40. As an **on-call engineer**, I want slow-query threshold defaulting to 1000ms, so that only genuinely slow statements are captured without tuning on day one.

## Implementation Decisions

### Architecture (locked from grill)

```
RDS PostgreSQL (jsonlog)
   → CloudWatch Logs (/aws/rds/instance/<id>/postgresql, retention 3–7 days)
   → CloudWatch Logs subscription filter
   → lambda-promtail (Lambda in VPC)
   → Loki on EC2 (private IP:3100, 30-day retention)
   → Grafana (dashboard + alerts → existing SNS contact point)
```

### RDS logging profile

- **Enabled content:** errors and warnings, slow queries (`log_min_duration_statement = 1000` ms), `log_connections`, `log_disconnections`, `log_lock_waits`.
- **Not enabled:** `log_statement=all` (volume and PII risk).
- **Format:** `jsonlog` when Postgres engine ≥ 15; otherwise `stderr` with explicit line prefix and downstream regex parsing.
- **Export:** enable RDS CloudWatch Logs export for `postgresql`.
- **Reboot:** any parameter-group change requiring reboot is scheduled in the **next maintenance window**.

### CloudWatch → Loki relay

- **Mechanism:** Grafana official **lambda-promtail** (not Alloy, not custom Lambda).
- **Delivery:** direct **CloudWatch Logs subscription filter** to Lambda (not Kinesis Firehose).
- **Connectivity:** Lambda runs in **VPC private subnets**; pushes to Loki at `http://<EC2_PRIVATE_IP>:3100/loki/api/v1/push`.
- **Network security:** dedicated Lambda security group; inbound to EC2 Loki port 3100 allowed **only** from Lambda SG; Loki must **not** be publicly reachable.
- **CloudWatch retention:** 3–7 days (transient relay only).

### Loki labeling and parsing

- **Labels (low cardinality):** `job=rds-postgres`, `environment`, `error_severity`.
- **Line content:** full JSON log fields (`message`, `detail`, `query`, `duration`, etc.) queried via LogQL `| json`.
- **Do not label:** query text, session IDs, or other high-cardinality fields.
- **Independence:** RDS logs are a separate stream from PM2 Promtail scraping; no change to existing app-log pipelines.

### Grafana deliverables

- **Dashboard (production, then staging):** panels for log volume by `error_severity`, FATAL/PANIC feed, slow-query feed, connection/disconnection rate, top error messages.
- **Alerts (production rules):**
  - Any FATAL or PANIC in a short window.
  - Error-rate spike (`error_severity=ERROR` count over threshold).
- **Routing:** existing SNS webhook contact point and notification policies; staging remains non-paging per current staging policy.

### Infrastructure as Code

- New CloudFormation stack under the existing **infrastructure** pattern (mirroring the SNS alert stack).
- Parameterize: RDS instance identifier, VPC ID, private subnet IDs, Lambda and EC2 security group IDs, Loki private endpoint, environment label.
- IAM: Lambda VPC access execution role plus CloudWatch Logs read permissions scoped to the RDS log group; `lambda:InvokeFunction` permission for `logs.amazonaws.com` on the subscription filter.

### Rollout order

1. **Production:** RDS logging + CloudFormation + Grafana dashboard/alerts + validation.
2. **Staging fast-follow:** redeploy stack with staging parameters; add staging dashboard and rules.

### Prerequisites (discovery before build)

- Production RDS instance identifier and Postgres engine version.
- VPC ID and private subnet IDs for Lambda.
- EC2 host private IP and security group ID.
- Confirmation whether RDS uses a default or custom parameter group (reboot implications).
- Confirmation Loki port 3100 is reachable on the private interface (security group, not public bind).

### Architectural notes

- **Highest test seam:** end-to-end **observable log presence in Loki** with correct labels, queryable in Grafana, and alert firing on synthetic FATAL/error conditions. This is the single integration boundary that proves the whole pipeline.
- **Single seam preferred:** validate at the Loki/Grafana boundary rather than unit-testing internal Lambda parsing or CloudFormation resource graphs separately.
- Existing **SQL Postgres datasource** and **Prometheus DB connectivity metrics** remain separate concerns; this PRD is logs only.

## Testing Decisions

### What makes a good test

- Assert **observable external behavior**: Postgres server log lines appear in Loki with expected labels; Grafana Explore and dashboard panels return results; configured alerts transition to firing on test conditions.
- Do **not** assert internal CloudFormation resource names, Lambda environment variable ordering, or implementation details of lambda-promtail unless a minimal contract test is added for label extraction.
- Prefer **one end-to-end validation path** over many shallow unit tests on infra templates.

### Primary seam (recommended)

**Loki + Grafana query boundary** (production or staging after deploy):

- Query `{job="rds-postgres", environment="production"} | json` in Grafana Explore and confirm recent lines with parseable `error_severity`.
- Confirm dashboard panels populate within expected time after known log events.
- Confirm FATAL/PANIC and error-rate alert rules evaluate and route per environment policy.

### Secondary seams

| Seam | Behavior under test | Prior art |
|------|---------------------|-----------|
| CloudWatch subscription filter metrics | Lambda invocations increase when RDS emits logs | AWS console / CLI checks in deploy checklist |
| RDS parameter group | Logging settings applied; reboot deferred to maintenance window if pending | RDS console pending-reboot indicators |
| Grafana alert provisioning | New rules appear under production folder; staging muted | Existing Grafana alert routing PRD rollout pattern |
| SNS notification path | Production FATAL alert reaches email/Slack | `infrastructure/sns/test-alerts.sh`, system monitoring testing guide |
| Security group rule | Lambda can reach Loki:3100; public internet cannot | Manual network verification in checklist |

### Manual test plan

1. **Pre-deploy:** confirm RDS engine version; choose `jsonlog` vs stderr fallback.
2. **Post RDS config:** verify CloudWatch log group receives `postgresql` export lines after reboot (if required).
3. **Post CloudFormation:** confirm subscription filter invocations and Lambda success metrics.
4. **Loki validation:** run Explore query; confirm `job`, `environment`, `error_severity` labels.
5. **Benign generators:** execute a query slower than 1000ms; trigger a harmless SQL error; confirm both appear with correct severity.
6. **Alert validation:** confirm FATAL/PANIC test (or simulated label match) fires production alert and reaches SNS path; confirm staging does not page production channels.
7. **Staging fast-follow:** repeat steps 3–6 with staging parameters.

### Automated tests (optional, out of scope unless requested)

- CloudFormation template lint (`cfn-lint`) in CI.
- Snapshot test of Grafana alert rule YAML for new Postgres rules.
- No application unit tests required — no application code changes.

## Out of Scope

- PostgreSQL **metrics** exporters (`postgres_exporter`, `pg_stat_statements` dashboards).
- Loki authentication, TLS termination in front of Loki, and S3 remote storage hardening.
- Refactoring existing application log transport (LokiTransportService silent failures, Promtail staging environment label bug).
- Changing application database connection pooling, Prisma configuration, or RDS Proxy work from the connection-budget plan.
- Enabling `log_statement=all` or broad statement logging.
- Kinesis Data Firehose as an intermediate buffer.
- Grafana CloudWatch datasource as an alternative query path.
- On-host PostgreSQL Promtail file scraping (only relevant if DB is moved off RDS).
- Documentation refresh for unrelated stale infra references (Grafana port history, Amplify vs EC2).
- ClickUp issue creation (use `/to-issues` separately).

## Further Notes

### Grill session decisions (locked)

| # | Decision |
|---|----------|
| 1 | Postgres hosting: **AWS RDS** |
| 2 | Surfacing: **CloudWatch → Loki** (unified, not CloudWatch datasource) |
| 3 | Mechanism: **lambda-promtail** |
| 4 | Delivery: **direct subscription filter** |
| 5 | Connectivity: **VPC-private Lambda → Loki private IP:3100** |
| 6 | Log content: errors + slow (1s) + connections + lock waits |
| 7 | Format: **jsonlog** (fallback stderr if < PG 15) |
| 8 | Labels: `job`, `environment`, `error_severity` |
| 9 | Retention: CloudWatch **3–7 days**; Loki **30 days** |
| 10 | Reboot: **maintenance window** |
| 11 | Grafana: **dashboard + FATAL/PANIC + error-rate alerts** |
| 12 | IaC: **CloudFormation** under infrastructure |
| 13 | Rollout: **production first**, staging fast-follow |

### Risks

- **Postgres < 15:** `jsonlog` unavailable; use stderr + parsing pipeline.
- **RDS reboot:** custom parameter group attachment may require maintenance-window reboot.
- **Unauthenticated Loki:** mitigated by VPC-private hop and SG restriction; auth hardening is follow-up.
- **PII in slow-query logs:** statement text may appear for slow queries; `log_statement=all` deliberately avoided.

### Related work (not blocking)

- Database connection budget / RDS Proxy plan — separate effort; connectivity metrics already exist in Prometheus.
- Grafana alert routing optimization — existing SNS path and staging mute policies should be reused for new Postgres log alerts.

### Rollout reminder

After Grafana provisioning changes: recreate the Grafana container via the logging Docker Compose stack so dashboard and alert rules reload. After CloudFormation deploy: verify subscription filter, Lambda VPC connectivity, and Loki ingest before enabling production alert noise.

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
