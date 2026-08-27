---
name: remove-lambda-cron-endpoint
overview: Remove the legacy Lambda/EventBridge cron HTTP tick and all related auth/env leftovers. Worker + Redis/BullMQ remain the only scheduler. Deploy staging → production, then delete EventBridge + Lambda in AWS.
source: grill-me session (Aug 2026)
isProject: true
---

# Remove Lambda cron endpoint

## Problem

Cron schedules already run on the Nest **worker** via Redis/BullMQ. Staging/production set `ENABLE_CRON_JOBS=false`, so `GET|POST /api/system/cron` is a no-op. EventBridge + Lambda still call that route. Dead code and auth bypasses (`CRON_SECRET`, `CronSecretGuard`, DualAuth cron path) should be removed.

## Decision log

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Cleanup depth | Remove endpoint + all Lambda auth leftovers | Delete `/api/system/cron`, `runCronFromLambda`, `ENABLE_CRON_JOBS`, `CronSecretGuard`, DualAuth cron bypass, `CRON_SECRET` usage, OpenAPI entry; update soak + active scripts |
| D2 | AWS vs code order | Deploy code first, then delete EventBridge | Accept short-lived 404s from the rule until AWS cleanup |
| D3 | Rollout | Staging first → production → delete EventBridge | Verify worker `/health` on staging before prod |
| D4 | Frontend | Same pass — OpenAPI + `amplify.yml` comment | Keep FE docs in sync with backend |
| D5 | `monitor-active-field.ts` | Strip HTTP trigger; keep DB monitoring | Drop `/api/system/cron` call and secret |
| D6 | Quarantine / historical plans | Leave alone | Only live compose, auth, API, OpenAPI, soak, active scripts |
| D7 | Soak check | Drop `ENABLE_CRON_JOBS` check; update checklist text | Optional `--worker-url` health remains |
| D8 | AWS cleanup | EventBridge rule + cron Lambda (+ log group if easy) | Full caller stack gone |
| D9 | Host env | Checklist after prod: remove `CRON_SECRET` / `ENABLE_CRON_JOBS` if present | No code beyond compose |
| D10 | Staging bar | Worker `/health` OK only | Do not wait on a job `last_run_at` |

## Keep (out of scope to remove)

- Nest worker + BullMQ queue `archaser-cron`
- `POST /api/gateway/cron/sync-schedules` and `POST /api/gateway/cron/:jobId/run-now`
- Admin cron UI / Postgres `CronJob` rows
- Unrelated Lambdas (e.g. lambda-promtail, SNS)

## Codebase scan

### Required

| File | Why |
|------|-----|
| `api/src/system/system.controller.ts` | Remove `SystemCronLambdaController` + cron routes |
| `api/src/system/system.module.ts` | Unregister controller |
| `api/src/system/system.service.ts` | Delete `runCronFromLambda` |
| `api/src/auth/cron-secret.guard.ts` | Re-export stub; delete (matches `*secret*` ignore pattern) |
| `packages/auth/src/cron-secret.guard.ts` | Delete guard implementation |
| `packages/auth/src/auth.module.ts` | Stop providing/exporting `CronSecretGuard` |
| `packages/auth/src/index.ts` | Stop exporting `CronSecretGuard` |
| `packages/auth/src/dual-auth.guard.ts` | Remove cron secret helpers + `/api/system/cron` bypass |
| `docker-compose.backend.staging.yml` | Remove `ENABLE_CRON_JOBS` |
| `docker-compose.backend.production.yml` | Remove `ENABLE_CRON_JOBS` |
| `api/openapi.json` | Remove `/api/system/cron` |
| `api/src/queue/cron-queue.controller.ts` | Drop cutover/`ENABLE_CRON_JOBS` wording in OpenAPI summary |
| `scripts/soak/check-soak-readiness.ts` | Drop env check; update checklist text (D7) |
| `scripts/testing/monitor-active-field.ts` | Strip HTTP trigger (D5) |
| `frontend/openapi/openapi.json` | Remove `/api/system/cron` (D4) |
| `frontend/amplify.yml` | Drop `ENABLE_CRON_JOBS` comment (D4) |

### Optional / out of scope

| File | Why |
|------|-----|
| `scripts/_quarantine/**` | D6 — leave |
| `.cursor/plans/*.plan.md` / PRDs mentioning old cron | D6 — historical |
| Host `.env` on EC2 | D9 — manual checklist, not a PR file |
| AWS EventBridge / Lambda / log group | D8 — manual after prod |

### No change needed

| File | Why |
|------|-----|
| `worker/src/main.ts` | Already owns schedules |
| `api/src/queue/cron-queue.service.ts` | Gateway enqueue stays |
| Prisma `CronJob` schema | Still used by worker |
| Grafana cron dashboards | Still valid for worker runs |

## Implementation steps

1. **Backend auth cleanup** — delete `CronSecretGuard` (package + API stub); remove DualAuth cron bypass and hardcoded secret fallback; rebuild `@archaser/auth` dist as usual.
2. **Backend API cleanup** — remove `SystemCronLambdaController`, `runCronFromLambda`, module registration.
3. **Compose** — remove `ENABLE_CRON_JOBS` from staging + production compose.
4. **OpenAPI / comments** — strip `/api/system/cron` from backend OpenAPI; fix gateway cron controller summary.
5. **Scripts** — soak checklist (D7); strip trigger from `monitor-active-field.ts` (D5).
6. **Frontend** — OpenAPI + `amplify.yml` (D4).
7. **Deploy** — staging → confirm `http://127.0.0.1:3003/health` (or host equivalent) → production (D3, D10).
8. **AWS** — delete EventBridge rule/schedule + cron Lambda (+ log group if easy) (D2, D8).
9. **Host env** — remove leftover `CRON_SECRET` / `ENABLE_CRON_JOBS` if present (D9).

## Rollout checklist

1. Merge/deploy **staging** backend (and FE OpenAPI/amplify if shipping together).
2. On staging host: `curl -s http://127.0.0.1:3003/health` → OK.
3. Optional: confirm `/api/system/cron` is 404 (not required by D10).
4. Deploy **production**.
5. Confirm production worker `/health`.
6. Delete EventBridge + Lambda (+ log group).
7. Scrub host env vars if present.

## Discovery gates (informational)

| Gate | If Yes | If No |
|------|--------|-------|
| Exact EventBridge rule / Lambda names found in AWS console | Delete those resources (D8) | Search by target URL `/api/system/cron` or function env `CRON_SECRET` before deleting |
| Hardcoded cron secret ever used outside this path | Treat as historically exposed; already removed from DualAuth/script in this PR | N/A — removal still required |

## Testing strategy

| Unit | Requirement | Approach |
|------|-------------|----------|
| T1 | `/api/system/cron` gone | After deploy or local API: GET/POST → 404 (or Nest “Cannot GET”) |
| T2 | DualAuth no longer accepts cron secret | Request with only `x-cron-secret` to a DualAuth route → 401 |
| T3 | Worker still schedules | Staging: worker `/health` OK (D10) |
| T4 | Gateway enqueue still works | Optional: `POST /api/gateway/cron/sync-schedules` with JWT still enqueues |
| T5 | Soak script | `check-soak-readiness` no longer references `ENABLE_CRON_JOBS`; checklist mentions worker owns schedules / Lambda endpoint removed |
| T6 | Static | `npx tsc --noEmit` on api + packages/auth after deletes |

## Plan improvements / notes

- `cron-secret.guard.ts` matches `.cursorignore` `**/*secret*` — agents may not see it in default search; delete by known path.
- Rebuild/publish `@archaser/auth` dist so `dist/` does not keep exporting `CronSecretGuard`.
- Do **not** remove Redis or the worker container.
