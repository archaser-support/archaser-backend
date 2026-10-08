# Deploy silence for DB disconnect alerts

## Overview

Production deploys restart Nest (`pm2` or Docker). While the API is restarting or MongoDB is reconnecting, gauges `archaser_db_mongodb_connected` / `archaser_db_postgres_connected` can stay at `0` longer than the Grafana rule `for: 2m`, which fires critical email for **MongoDB Disconnected** / **PostgreSQL Disconnected**.

**Fix:** best-effort Grafana silence (15 minutes) for those two alert names in the Production folder, created before restart. Do not swallow app errors; do not lengthen `for:`.

## Decision log

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | What to mute | MongoDB + PostgreSQL disconnect alerts only | Leave other critical alerts active |
| D2 | How to suppress | Deploy script creates a short Grafana silence | Precise to deploys |
| D3 | Silence length | 15 minutes | Covers Nest + Mongo + Grafana reload |
| D4 | Deploy paths | Both production paths (PM2 + Docker) | Shared helper; skip staging |
| D5 | Silence API failure | Warn and continue deploy | Do not block releases on mute |
| D6 | Manual restarts | Shared helper + standalone script | Same mute for deploys and hand restarts |

## Approach

1. Add `scripts/deployment/silence-db-disconnect-alerts.sh` that POSTs to Grafana Alertmanager silence API (`/api/alertmanager/grafana/api/v2/silences`).
2. Auth: reuse `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` (+ `GRAFANA_URL` / `GRAFANA_HOST_PORT`) from `.env` / `.env.production`, same pattern as `cleanup-grafana-empty-folders.sh`.
3. Matchers: `alertname` regex for `MongoDB Disconnected|PostgreSQL Disconnected` + `grafana_folder=Production`.
4. Call from `deploy-production.sh` (remote, before `pm2 restart`) and `deploy-backend-docker.sh` when `--env production` (before stack recreate), always warn-and-continue on failure.
5. Skip staging (notifications already muted via `staging-no-notify`).

## Codebase scan

### Required

| File | Why |
|------|-----|
| `scripts/deployment/silence-db-disconnect-alerts.sh` | New standalone + helper (EC2 / deploy; may load host `.env`) |
| `scripts/deployment/silence_db_disconnect_alerts.py` | Laptop/API verify helper — env/flags only, no dotenv read |
| `scripts/deployment/deploy-production.sh` | Wire silence before PM2 restart on EC2; **include script in deploy tar** (was only packaging `verify-routes-manifest.js`) |
| `scripts/deployment/deploy-backend-docker.sh` | Wire silence before production stack recreate |

### Optional / out of scope

| Item | Why |
|------|-----|
| Lengthen `for:` on disconnect rules | Explicitly rejected (D2) |
| Mute all critical alerts | Explicitly rejected (D1) |
| Staging deploy hooks | Staging notify already muted |
| Grafana rule YAML / mute-timings | Silence API preferred over schedule mutes |
| App metrics / Nest health code | Alert is correct; mute notifications only |
| Unit/integration tests | Not requested |
| FE / i18n | No user-facing product copy |

### No change needed

| File | Why |
|------|-----|
| `grafana/provisioning/alerting/rules-production.yaml` | Keep `for: 2m` for real outages |
| `grafana/provisioning/alerting/mute-timings.yaml` | Staging always-on mute only |
| `grafana/provisioning/alerting/notification-policies.yaml` | Critical routing unchanged |
| `api/src/metrics/metrics-updater.service.ts` | Gauge behavior correct |
| ClickUp / alert email Lambda | Silence prevents notification upstream |

## Implementation notes

- Default duration: `SILENCE_MINUTES=15` (overridable).
- Default Grafana URL: `http://127.0.0.1:${GRAFANA_HOST_PORT}` with production default port **3201** when port unset and env is production.
- Standalone exit non-zero on failure; deploy wrappers use `|| echo WARNING` (D5).
- Create silence **before** Nest restart / container recreate so the mute covers the gap.
- Silences persist in `grafana-db` volume across Grafana container recreate.

## How to test

1. Against public production Grafana (no dotenv read):
   ```powershell
   $env:GRAFANA_URL="https://grafana.portal.archaser.com"
   $env:GRAFANA_ADMIN_PASSWORD="..."
   py -3 scripts/deployment/silence_db_disconnect_alerts.py --verify-ship
   ```
   Expect: 15m silence active; 1m probe expires within ~2 minutes.
2. On production EC2: `MONITORING_ENV=production bash scripts/deployment/silence-db-disconnect-alerts.sh`
3. Optional: restart Nest during the 15m window; confirm no critical disconnect email.
4. After silence expires, a real prolonged disconnect still pages (expiry probe covers mute clearance).
5. With wrong/missing password: helper exits 1; deploy prints WARNING and continues.

## Testing strategy

| Unit | Requirement | Type |
|------|-------------|------|
| T1 | Silence created with correct matchers and ~15m window | Manual / ops |
| T2 | Production deploy continues if silence fails | Manual |
| T3 | Staging docker deploy does not call silence helper | Code review |

## Out of scope unless requested

- Service-account token instead of admin basic auth
- Auto-expire / delete silence when deploy finishes early
- Silencing other restart-sensitive alerts

## Verification status (live)

| Check | Status | Evidence |
|-------|--------|----------|
| Plan + `silence-db-disconnect-alerts.sh` + both deploy wires | Done | Files present; production-only on docker path; PM2 tar includes script |
| Silence failure only warns | Done | On EC2: wrong `GRAFANA_ADMIN_PASSWORD` → HTTP 401; WARNING continue path OK |
| Matcher titles match prod rules | Done | Listed silence matchers: `MongoDB Disconnected\|PostgreSQL Disconnected` + `grafana_folder=Production` |
| 15m silence on production Grafana | Done | EC2 → `http://127.0.0.1:3201` silence `ab1b5ff4-…` (also portal creates earlier) |
| Expiry clears mute | Done | 1m probe `4627ee47-…` → `expired`; `EXPIRY_PROBE_OK=True` |
| Nest restart during silence | Done | `docker restart archaser-backend-production-api-1` with active silence; after 180s both disconnect alerts `Normal` (no firing page) |
| Shared-host URL pitfall | Fixed | Production path prefers localhost:3201 over staging `GRAFANA_ROOT_URL` in shared `.env` |
| Script line endings | Fixed | Force LF (CRLF broke `set -o pipefail` on EC2) |
