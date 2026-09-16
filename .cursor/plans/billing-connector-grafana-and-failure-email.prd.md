---
name: billing-connector-grafana-and-failure-email
overview: Add a production Billing Connector Grafana dashboard mirroring staging, and send an email notification to internal ops when a billing connector sync ends in a non-SUCCESS state.
source: grill-me session
clickup_task_url: https://app.clickup.com/t/25708732/869edd6va
isProject: false
---

# Billing Connector — Grafana Production Dashboard & Failure Email Notifications

## Problem Statement

The billing connector sync execution logs and failure data are already surfaced in the **staging** Grafana dashboard ("Billing Connector - Staging"), but there is no equivalent for production. When a billing connector sync fails in production, the team has no dashboard to drill into Mongo-backed execution logs, and no proactive notification — errors are discovered reactively by checking Mongo directly or waiting for a customer report.

## Solution

1. **Grafana — production dashboard:** Create an `archaser-billing-connector-production.json` dashboard under `grafana/provisioning/dashboards/production/` that mirrors the staging dashboard with labels flipped to `environment=production`. Both Prometheus metric panels and Loki log panels will be included.

2. **Failure email notification:** In the `connectors` service (which runs the billing-connector sync via `packages/billing-connector`), hook into the post-sync lifecycle so that when a sync execution finishes with a non-SUCCESS status (`FAILED`, `PARTIAL`, `TIMEOUT`), an email is sent to a configurable list of internal addresses. A per-account in-memory cooldown (default 60 minutes, configurable) prevents repeated emails for the same account in a short window.

## User Stories

1. As a developer/ops team member, I want a Billing Connector Grafana dashboard for production so that I can monitor live sync health, error rates, and log lines the same way I do on staging.
2. As a developer/ops team member, I want Loki log panels (run history, recent errors, start lines, import row issues) in the production dashboard so that I can drill into Mongo connector log entries without accessing Mongo directly.
3. As a developer/ops team member, I want the production dashboard Prometheus panels to show `instance="Production"` metrics so that the data reflects the correct environment.
4. As a developer/ops team member, I want an email notification whenever a billing connector sync ends in a non-SUCCESS status (FAILED, PARTIAL, or TIMEOUT) so that failures are surfaced proactively.
5. As a developer/ops team member, I want the failure email to include account ID, provider, execution status, error message, and execution ID so that I can immediately understand what failed and look it up in Grafana.
6. As a developer/ops team member, I want notification emails to use a per-account cooldown window (default 60 minutes) so that a repeatedly-failing account does not flood my inbox.
7. As a developer/ops team member, I want the cooldown window to be configurable via an env var (`BILLING_CONNECTOR_ERROR_NOTIFY_COOLDOWN_MINUTES`) so that I can tune it without a code deploy.
8. As a developer/ops team member, I want the recipient list to be configurable via `BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS` so that new team members can be added or removed without a code deploy.
9. As a developer/ops team member, I want the email notification to only fire in production (gated by `NODE_ENV=production` or `BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED=true`) so that staging remains noise-free.
10. As a developer/ops team member, I want the notification to reuse the existing `sendSmtpHtmlEmail` utility from `packages/cron-jobs` so that SMTP/SES configuration is consistent across the system.
11. As a developer/ops team member, I want the cooldown state to live in-memory in the connectors process so that no new infrastructure dependencies are needed for a single-replica deployment.

## Implementation Decisions

### Grafana — production dashboard

- A new file `grafana/provisioning/dashboards/production/archaser-billing-connector-production.json` is created by forking `archaser-billing-connector-staging.json` with these changes:
  - Dashboard `uid`, `title`, and folder set to their production equivalents.
  - All Prometheus `expr` labels: `instance="Staging"` → `instance="Production"`.
  - All Loki stream selectors: `environment="staging"` → `environment="production"`.
  - Dashboard-level variable defaults updated to `production`.
- Loki datasource UID stays `Loki` (same datasource used for staging panels).
- Prometheus datasource UID stays `Prometheus`.
- No new provisioning entry is needed — the existing production folder yaml already picks up all files in the `production/` directory.

### Failure email notification — placement

- A new `BillingConnectorNotifyService` is added inside `packages/billing-connector/src/notify/`. It is a plain TypeScript class (no Nest DI, to keep the package environment-agnostic and usable from the BullMQ worker).
- The service exposes a single method `notifyOnFailure(result, executionId): Promise<void>`.
- It is called inside `finalizeSyncHistoryAfterRun` (or at the call site in `inProcessSyncLifecycle`) after the sync history is persisted.

### In-memory cooldown

- A `Map<number, Date>` keyed by `accountId` tracks the last notification timestamp per account.
- Before sending, the service checks whether `now - lastNotified < cooldownMs`. If within cooldown, skip silently.
- Cooldown is reset only on a successful send (or a permanent skip when SMTP is not configured).
- The map is a module-level singleton inside `packages/billing-connector`, matching the pattern of `ensureMongoConnection`.

### Email content

- Subject: `[ARchaser] Billing Connector Sync Failure — Account {accountId} ({provider}) — {status}`
- Body: plain-text/minimal HTML with account ID, provider, status, error message (≤500 chars), execution ID, and timestamp.
- Uses `sendSmtpHtmlEmail` from `packages/cron-jobs`. If `packages/billing-connector` does not currently depend on `packages/cron-jobs`, verify and add the workspace dependency; alternatively, create a thin re-export in `packages/billing-connector/src/notify/` to avoid a heavyweight dependency.

### Environment gate

- Enabled when `BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED=true` OR `NODE_ENV=production`.
- Recipients: `BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS` (comma-separated). Empty → skip silently.
- Cooldown: `BILLING_CONNECTOR_ERROR_NOTIFY_COOLDOWN_MINUTES` (default 60).

### Trigger condition

- Statuses that trigger: `FAILED`, `PARTIAL`, `TIMEOUT`.
- `SUCCESS` never triggers.
- For deferred post-ingest executions, the notification fires when the execution is finalized to a terminal non-SUCCESS status (the same `finalizeSyncHistoryAfterRun` path is called by the drain finalizer).

## Testing Decisions

- **Good tests** verify external behavior: given a sync result with a non-SUCCESS status and a configured notify list, an email is (or is not) sent. They do not assert internal implementation details like map keys.
- **BillingConnectorNotifyService unit tests:** test the cooldown logic — first failure sends, second within cooldown skips, after cooldown sends again. Mock `sendSmtpHtmlEmail`.
- **Grafana dashboard:** no automated tests; verified by loading the provisioned dashboard in a local docker-compose Grafana instance.
- **Prior art for similar tests:** `packages/cron-jobs/src/email/` patterns.

## Out of Scope

- Grafana alerting rule extensions (the existing SNS webhook pipeline could be extended separately).
- Customer-facing notification emails.
- Redis-backed cooldown state.
- Notification for the api-driven import flow (`import.service.ts`); only the billing-connector sync path.
- Creating a new Loki datasource.
- Notification channels other than email.

## Further Notes

- The staging dashboard uses `job="nest-docker"` and `compose_service=~"api|connectors|worker"` as Loki stream selectors. Verify these labels are consistent in production Loki ingestion before deploying.
- `sendSmtpHtmlEmail` returns `{ skipped: true }` when SMTP is not configured — the notify service must not consume the cooldown window on a skip.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/billing-connector-grafana-and-failure-email/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/billing-connector-grafana-and-failure-email/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Production Grafana billing connector dashboard | `issues/01-grafana-production-dashboard.md` | — | 1, 2, 3 |
| 2 | BillingConnectorNotifyService with cooldown | `issues/02-notify-service.md` | — | 4, 5, 6, 7, 8, 9, 10, 11 |
| 3 | Wire notify into sync lifecycle | `issues/03-wire-notify-into-lifecycle.md` | [02-notify-service](issues/02-notify-service.md) | 4, 5, 9 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
