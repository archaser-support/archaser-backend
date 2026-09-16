# Billing Connector — Grafana Production Dashboard & Failure Email Notifications

This feature delivers two observability improvements for the billing connector:

1. **Grafana production dashboard** — mirrors the existing staging "Billing Connector - Staging" dashboard for the production environment, including Prometheus metric panels and Loki log panels (run history, errors, import row issues).
2. **Failure email notification** — when a billing connector sync execution ends in a non-SUCCESS status (FAILED, PARTIAL, TIMEOUT), the connectors service emails a configurable list of internal recipients. A per-account in-memory cooldown (default 60 min, configurable) prevents inbox flooding.

**PRD:** `.cursor/plans/billing-connector-grafana-and-failure-email.prd.md`

Vertical slices live in `issues/`. Implement in dependency order; start a **fresh session per issue**.
