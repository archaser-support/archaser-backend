# 01 — Production Grafana Billing Connector Dashboard

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3
**PRD:** `.cursor/plans/billing-connector-grafana-and-failure-email.prd.md`

## What to build

Create `grafana/provisioning/dashboards/production/archaser-billing-connector-production.json` by forking the existing `archaser-billing-connector-staging.json` and updating all environment-specific labels to target production:

- Dashboard `uid` → new unique UID (e.g. `archaser-billing-connector-prod`)
- Dashboard `title` → `Billing Connector - Production`
- Dashboard folder → `Production`
- All Prometheus `expr` references: `instance="Staging"` → `instance="Production"`
- All Loki stream selectors: `environment="staging"` → `environment="production"`
- Any dashboard-level variable default values updated from `staging` to `production`

The Loki datasource UID (`Loki`) and Prometheus datasource UID (`Prometheus`) remain unchanged. No new provisioning YAML entry is needed — the existing `dashboard.yaml` for the production folder picks up all JSON files in that directory automatically.

## Acceptance criteria

- [ ] `grafana/provisioning/dashboards/production/archaser-billing-connector-production.json` exists
- [ ] The dashboard title is "Billing Connector - Production" and folder is "Production"
- [ ] All Prometheus expressions reference `instance="Production"` (not `instance="Staging"`)
- [ ] All Loki queries target `environment="production"` (not `environment="staging"`)
- [ ] The staging dashboard is unchanged
- [ ] The dashboard has a unique `uid` not colliding with any other provisioned dashboard

## How to test

1. Start local Grafana via `docker compose up grafana` (or the project's local dev compose command).
2. Open Grafana at `http://localhost:3000`.
3. Navigate to **Dashboards → Production** folder.
4. Confirm a "Billing Connector - Production" dashboard appears alongside the other production dashboards.
5. Open the dashboard — all Prometheus panels should load (they may show "No data" locally if Prometheus has no production scrape, but should not show query errors).
6. Open the "Run history (Loki)" and "Recent errors" panels — confirm the Loki query is targeting `environment="production"`.
7. Open the staging Grafana dashboard and confirm it still loads unchanged.
