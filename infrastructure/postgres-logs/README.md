# Postgres logs → Grafana (CloudWatch + lambda-promtail)

Implements [postgres-logs-to-grafana.prd.md](../../.cursor/plans/postgres-logs-to-grafana.prd.md).

```
RDS PostgreSQL (jsonlog)
  → CloudWatch Logs (/aws/rds/instance/<id>/postgresql, retention 3–7 days)
  → Subscription filter
  → lambda-promtail (VPC private subnets)
  → Loki on EC2 (private IP:3100)
  → Grafana dashboard + alerts
```

## Prerequisites (discover before apply)

| Value | How to get it |
|-------|----------------|
| RDS instance id + engine version | `aws rds describe-db-instances` |
| Parameter group family | `postgres15` / `postgres16` / … matching major version |
| VPC + private subnet IDs | Same VPC as Loki EC2 |
| EC2 private IP + Loki SG | Host running `docker-compose.logging.yml` |
| S3 bucket for Lambda zip | Any deploy-artifacts bucket in the account/region |

Confirm Loki `:3100` is reachable on the **private** interface and **not** open to `0.0.0.0/0`.

## Slice 1 — RDS logging + CloudWatch export

```bash
cp params.production.example.env params.production.env   # fill values
set -a && source params.production.env && set +a
chmod +x configure-rds-logging.sh
./configure-rds-logging.sh
```

What it does:

1. Creates `archaser-rds-logging-<env>` CloudFormation stack (custom parameter group).
2. Attaches the group with `ApplyImmediately=false` by default (reboot via **maintenance window**).
3. Enables CloudWatch export `postgresql` (no reboot).
4. Sets log group retention to 3–7 days.
5. Verifies `log_statement=none` (never `all`).

### Fallback if engine &lt; 15

`jsonlog` is unavailable. Redeploy slice 1 with:

```bash
export LOG_DESTINATION=stderr
./configure-rds-logging.sh
```

Then deploy slice 2 with stderr pipeline stages (regex on `log_line_prefix` that includes severity). Example:

```bash
export LOKI_STAGE_CONFIGS='[{"regex":{"expression":".* (?P<error_severity>DEBUG|INFO|NOTICE|WARNING|ERROR|FATAL|PANIC): .*"}},{"labels":{"error_severity":""}}]'
./deploy-lambda-promtail.sh
```

Tune the regex against a real stderr line from CloudWatch before production use.

## Slice 2 — lambda-promtail → Loki

```bash
set -a && source params.production.env && set +a
chmod +x deploy-lambda-promtail.sh
./deploy-lambda-promtail.sh
```

Creates `archaser-lambda-promtail-<env>` with:

- Grafana [lambda-promtail](https://github.com/grafana/lambda-promtail) `v1.0.0` zip from GitHub releases → S3 → Lambda (`provided.al2023`)
- VPC ENIs in private subnets + dedicated Lambda SG
- Ingress on Loki SG: **TCP 3100 from Lambda SG only**
- Subscription filter on the RDS `postgresql` log group
- Static labels: `job=rds-postgres`, `environment=<env>` (`OMIT_EXTRA_LABELS_PREFIX=true`)
- `LOKI_STAGE_CONFIGS` extracts `error_severity` from jsonlog into a Loki label
- `KEEP_STREAM=false` (no high-cardinality stream labels)

Validate:

```bash
./validate.sh
# Grafana Explore:
#   {job="rds-postgres", environment="production"} | json
```

## Slice 3 — Grafana dashboard + production alerts

Provisioned in-repo (no AWS change):

- `grafana/provisioning/dashboards/production/archaser-postgres-logs-production.json`
- Alert rules appended in `grafana/provisioning/alerting/rules-production.yaml`

Reload:

```bash
# on the monitoring host
export MONITORING_ENV=production
docker compose -f docker-compose.logging.yml up -d grafana --force-recreate
```

Production FATAL/PANIC alerts use `severity: critical` → existing SNS path. ERROR-rate uses `severity: high` → digest tier.

## Slice 4 — Staging fast-follow

```bash
cp params.staging.example.env params.staging.env   # fill staging values
set -a && source params.staging.env && set +a
./configure-rds-logging.sh
./deploy-lambda-promtail.sh
```

Staging Grafana assets:

- `grafana/provisioning/dashboards/staging/archaser-postgres-logs-staging.json`
- Rules in `grafana/provisioning/alerting/rules-staging.yaml` (folder **Staging** → `silent-staging` receiver; no production SNS)

```bash
export MONITORING_ENV=staging
docker compose -f docker-compose.logging.yml up -d grafana --force-recreate
```

## Security notes

- Loki stays unauthenticated; mitigation is VPC-private hop + SG lock to Lambda SG on 3100.
- Prefer a **VPC interface endpoint for `logs`** (or NAT) so the VPC Lambda can write its own CloudWatch function logs.
- Do not enable `log_statement=all`. Slow-query text may still contain literals — accepted for this profile.

## ClickUp slices

| # | Task | ID |
|---|------|-----|
| 1 | RDS logging + CloudWatch | [869e4zghx](https://app.clickup.com/t/869e4zghx) |
| 2 | lambda-promtail pipeline | [869e4zgj8](https://app.clickup.com/t/869e4zgj8) |
| 3 | Grafana dashboard + alerts | [869e4zgm4](https://app.clickup.com/t/869e4zgm4) |
| 4 | Staging fast-follow | [869e4zgmx](https://app.clickup.com/t/869e4zgmx) |
