---
name: billing-connector-drop-status
overview: Remove BillingConnector.status; scheduled sync and eligibility use only sync_enabled. Auth circuit breaker turns sync_enabled off via consecutive_auth_failures.
source: staging incident account 10149 (sync enabled in UI, status=Disabled blocked cron)
isProject: false
---

# Drop BillingConnector status — use sync_enabled only

## Problem Statement

`BillingConnector` has two overlapping switches:

- `sync_enabled` — admin Sync Enabled toggle (visible)
- `status` (`Active` / `Disabled` / `Error`) — mostly invisible; cron requires `status = Active`

Default `status` is `Disabled`, and the app never promotes it to `Active` when Sync Enabled is turned on. Account **10149** on staging had `sync_enabled = true` and last Invoice/Payment success on **2026-09-14**, but scheduled sync stopped because `status` stayed `Disabled`. The UI still showed “Next scheduled sync” from cron math alone.

## Solution

Remove `BillingConnector.status` and the `BillingConnectorStatus` enum. **Sync eligibility = `sync_enabled` only.**

Auth circuit breaker (locked): keep `consecutive_auth_failures`; at threshold (≥3) set **`sync_enabled = false`** (and reset/clear failures when connection test succeeds or sync is re-enabled — align with existing banner). Do **not** keep a separate Error status column.

Ops: after code ships (or immediately with a one-line status clear if needed before ship), account 10149 resumes on the next Sync Billing Connectors tick when `sync_enabled` is true.

**Implemented (2026-09-16):** code + migration `20260916_drop_billing_connector_status.sql` applied on staging; cron uses `sync_enabled` only.

## Decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | Eligibility | Cron / metrics “active connector” filters use `sync_enabled` only |
| D2 | Remove | Drop column `status` + enum `BillingConnectorStatus` |
| D3 | Auth / Error | Option **1**: no Error status; trip breaker → `sync_enabled=false` via `consecutive_auth_failures` |
| D4 | UI | Sync Enabled remains the only on/off; circuit banner uses failures ≥3 (drop `status === "Error"`) |
| D5 | API | Stop returning `status` from public connector config (or ignore if briefly left for compat — prefer remove) |

## User Stories

1. As an admin with Sync Enabled on, I want scheduled ERP sync to run on the cron schedule, so that I am not blocked by a hidden status field.
2. As an admin, I want turning Sync Enabled off to stop scheduled sync, so that one toggle controls automation.
3. As an admin after repeated auth failures, I want sync to turn off automatically and see the existing warning, so that bad credentials do not hammer the ERP.
4. As an admin who fixes credentials and turns Sync Enabled back on, I want scheduled sync to resume, so that recovery does not require SQL.
5. As an ops engineer, I want Grafana “connectors in error” to mean tripped breakers (e.g. `consecutive_auth_failures >= 3` and/or `sync_enabled = false` with recent auth failure), so that alerts survive without `status=Error`.
6. As a platform engineer, I want Prisma/API/frontend types free of `BillingConnectorStatus`, so that the dual gate cannot regress.

## Implementation outline

1. **Hot path (unblocks production behavior even before migration):** `syncDueBillingConnectors` — remove `status: "Active"` from `where`; keep `sync_enabled: true`.
2. **Metrics:** `metrics-updater` — replace `status: "Error"` / `status: "Active"` connector filters with `sync_enabled` + failure-based error count.
3. **API serialize:** `billing-connector.service` + Nest `accounts-nested.service` — stop exposing `status`.
4. **Frontend:** drop `status` from config types; circuit banner = `consecutive_auth_failures >= 3` only; remove `BillingConnectorStatus` from `types/db.ts` if unused elsewhere.
5. **Auth trip (if not already implemented):** on auth failure path, increment `consecutive_auth_failures`; at ≥3 set `sync_enabled: false`. On successful connection test / successful sync, reset failures (and do not require status).
6. **Schema:** migration drop `status` column + enum (safe additive deploy: code first that ignores status, then drop column).
7. **Staging 10149:** no status flip needed once cron ignores status; optional verify next tick after deploy.

## Codebase scan

### Required

| Area | Path | Why |
|------|------|-----|
| Cron due sync | `packages/billing-connector/src/services/syncDueBillingConnectors.ts` | Filters `status: "Active"` |
| Prisma | `prisma/schema.prisma` | Enum + column |
| Migration | new SQL under `prisma/migrations/` | Drop column/enum (after code ignores status) |
| API config | `api/src/billing-connector/billing-connector.service.ts` | Serializes `status` |
| Nest accounts | `connectors/src/accounts/accounts-nested.service.ts` | Serializes `status` |
| Metrics | `api/src/metrics/metrics-updater.service.ts` | `status: "Error"` / `status: "Active"` on connector |
| Metrics defs | `api/src/metrics/archaser-business-metrics.ts` | Gauge help text may mention Error status |
| FE settings | `frontend/.../BillingIntegrationSettings.tsx` | `config?.status === "Error"` in circuit breaker |
| FE types | `frontend/shared/services/billingConnectorService.ts`, `frontend/types/db.ts` | `status` / `BillingConnectorStatus` |
| Original plan note | `.cursor/plans/erp_billing_connector_22321e7a.plan.md` | Documented `status=Error` breaker — supersede with D3 |

### Optional / out of scope unless requested

| Area | Reason |
|------|--------|
| Grafana dashboard JSON | May still label “in Error”; update copy when metrics query changes |
| Unit tests for sync due | Only if user asks for tests |
| ClickUp task | Create when starting `/start-work` |
| Immediate staging SQL `status=Active` | Unneeded after hot-path fix; optional interim if deploy delayed |

### No change needed

| Area | Reason |
|------|--------|
| Unrelated `status: "Active"` (Customer, Policy, BusinessUnit, collection_status) | Different models |
| `GenericStats` `config.status` | Customer/account stats, not billing connector |
| Sync history run `status` (RUNNING/SUCCESS/FAILED) | Execution status, not connector lifecycle |
| `sync_enabled` UI / schedule presets | Already correct product control |
| i18n | No new user-facing strings required for MVP (banner already exists) |

## Testing Strategy

Map to stories (manual unless tests requested):

| Story | How to verify |
|-------|----------------|
| 1–2 | Connector with `sync_enabled=true`, any legacy status → due cron processes; toggle off → skipped |
| 3–4 | Force auth failures ≥3 → `sync_enabled` false + banner; fix creds, enable sync → runs again |
| 5 | Metrics updater count matches tripped connectors without `status=Error` |
| 6 | tsc: no remaining `BillingConnectorStatus` references |

**How to test (staging 10149):** After deploy, confirm Sync Enabled on, wait for Sync Billing Connectors tick (or trigger), confirm Invoice/Payment `last_successful_run_at` advances past 2026-09-14.

## Out of scope

- Redesigning schedule presets or Sync Settings layout
- New UI for “connector health” beyond existing circuit banner
- Changing ImportJob cron freeze behavior
- Auto-re-enable sync after auth recovery without admin toggle (unless already implemented)

## Suggest plan improvements

- **Ship order:** code ignores `status` first (fixes 10149 without waiting on DROP COLUMN), then migration removes column.
- **Confirm auth trip is implemented:** scan found no `consecutive_auth_failures` writes in `packages/billing-connector` — may need to implement D3 trip, not only remove status.
- **Grafana:** update query from `status=Error` to failure/`sync_enabled` semantics in same PR if the dashboard is in-repo.
- **API compat:** removing `status` from JSON is fine for our FE; no external public API assumed.
