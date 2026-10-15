# Deploy-status maintenance overlay (S3 flag)

**ClickUp:** [Deploy-status maintenance overlay (S3 flag, no /health)](https://app.clickup.com/t/869fhcfp1)  
**Repos:** Frontend (`archaser-frontend`) + Backend workflow (`archaser-backend`)  
**Status:** implemented in code — **ops gate still required** (bucket + Amplify/GHA secrets) before it works in the wild

## Problem

The Amplify UI shows “ARchaser is being updated” when Nest `/health` fails or product APIs return 502/503. That flashes during normal page load / API pressure, not only during real deploys. Staging currently disables the overlay entirely as a temporary workaround.

## Goal

Show the maintenance overlay **only while a backend EC2 deploy is running**, driven by a **public deploy-status flag** written by GitHub Actions — **not** by `/health` or product API failures.

## Decision log (grill-me)

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | How UI learns deploy is running | Deploy workflow sets a flag the UI polls | No browser→GitHub secrets |
| D2 | Where the flag lives | Public S3 / CloudFront JSON | Readable while Nest is down |
| D3 | Which deploys | Backend “Deploy Backend to EC2” only | Not Amplify FE builds |
| D4 | When set/clear | On at **Deploy-to-EC2 job** start; off in `if: always` final step | Skip typecheck window |
| D5 | Stuck flag | `updatedAt` + UI max age **60 minutes** | Overlay cannot stick forever |
| D6 | Env separation | Separate `staging.json` and `production.json` | Staging deploy ≠ production overlay |
| D7 | `/health` for overlay | **Remove** — overlay only from S3 flag | No false flashes |
| D8 | When flag clears | Full page reload | Recover failed in-page requests |
| D9 | Where overlay runs | **Staging and production** (recommended locked) | Remove temporary staging disable |

## Discovery gate (blocking)

| Gate | If Yes | If No |
|------|--------|-------|
| **Public status bucket / CloudFront URL chosen** (read anonymously from browser; write from GHA OIDC or keys) | Implement FE poll URL + GHA upload steps | Blocked — ops picks bucket/prefix before coding against a real URL |

Informational: CORS on the status object (or CloudFront) must allow `GET` from `staging.archaser.com` and `portal.archaser.com` (and `www` variants).

## Proposed status file shape

Keys (example):

- `s3://<bucket>/deploy-status/staging.json`
- `s3://<bucket>/deploy-status/production.json`

```json
{
  "deploying": true,
  "env": "staging",
  "updatedAt": "2026-10-15T05:30:00.000Z",
  "workflowRunId": "38543995059",
  "workflowRunUrl": "https://github.com/archaser-support/archaser-backend/actions/runs/38543995059"
}
```

When idle: `deploying: false` with a fresh `updatedAt`.

**UI rule:** treat as deploying only if `deploying === true` **and** `updatedAt` is within the last **60 minutes**.

## Architecture

```text
GitHub Actions (Deploy Backend to EC2)
  ├─ typecheck          (no flag change)
  └─ deploy job
       ├─ START: write staging|production.json { deploying: true, updatedAt }
       ├─ SSH + docker deploy…
       └─ always(): write { deploying: false, updatedAt }

Amplify UI (per host → env)
  └─ poll status JSON every ~5s
       ├─ deploying + fresh → show overlay
       └─ was deploying → now false/expired → hide + location.reload()
```

## Implementation plan

### Phase 0 — Ops (gate)

1. Create or reuse a bucket (or CloudFront distribution) for public read of `deploy-status/*.json`.
2. Grant GitHub Actions write access (prefer OIDC to AWS; document secrets if keys).
3. Publish the public base URL (e.g. `https://status.…/deploy-status/`).
4. Seed both JSON files with `deploying: false`.

**GitHub Actions secrets (backend repo):**

| Secret | Purpose |
|--------|---------|
| `DEPLOY_STATUS_S3_BUCKET` | Bucket name |
| `DEPLOY_STATUS_AWS_ACCESS_KEY_ID` | Writer IAM key |
| `DEPLOY_STATUS_AWS_SECRET_ACCESS_KEY` | Writer IAM secret |
| `DEPLOY_STATUS_AWS_REGION` | Optional (default `eu-central-1`) |
| `DEPLOY_STATUS_S3_PREFIX` | Optional (default `deploy-status`) |

**Amplify console (FE, both branches):**

| Env var | Example |
|---------|---------|
| `NEXT_PUBLIC_DEPLOY_STATUS_BASE_URL` | `https://<bucket-or-cdn>/deploy-status` (no trailing slash) |

Without these, deploys still succeed (status steps no-op / continue-on-error) and the UI never shows the overlay (except `?previewMaintenance=1`).

### Phase 1 — Backend workflow

**File:** `archaser-backend/.github/workflows/deploy-backend-ec2.yml`

1. After “Determine Environment & Directory”, add **Set deploy status (on)** before SSH (only on the deploy job, not typecheck).
2. Add **Clear deploy status (off)** as the last step with `if: always()`.
3. Map `ENV=staging|production` → object key.
4. Upload JSON via `aws s3 cp` (or equivalent) with `Cache-Control: no-cache` / short max-age so the UI sees updates quickly.
5. Do **not** set the flag for Amplify / FE-only pipelines.

### Phase 2 — Frontend overlay

**Replace health-driven outage detection for the overlay:**

1. `utils/apiAvailability.ts` (or new `utils/deployStatus.ts`):
   - Resolve env from hostname (`staging.*` → staging, portal → production).
   - Poll `NEXT_PUBLIC_DEPLOY_STATUS_BASE_URL/{env}.json`.
   - Show overlay from flag + max-age only.
   - On transition deploying→idle: `window.location.reload()`.
2. `components/DeploymentMaintenance.tsx`:
   - Poll deploy status instead of `probeApiHealth`.
   - Remove temporary staging hard-disable (`isDeploymentMaintenanceEnabled` staging skip) so staging uses the flag.
   - Keep `?previewMaintenance=1` for QA.
3. `utils/apiFetch.ts` / `app/api.ts`:
   - **Stop** calling `noteUpstreamUnavailable` for overlay purposes (remove hooks or make them no-ops). Product errors stay normal toasts/errors.
4. Env: `NEXT_PUBLIC_DEPLOY_STATUS_BASE_URL` in Amplify staging + production (and local optional).
5. Copy: reuse existing `messages.deployment_*` EN/HE — no new strings unless copy changes.

### Phase 3 — Cleanup

1. Delete or narrow unused `/health` overlay helpers if nothing else needs them.
2. Document ops runbook: stuck flag, manual S3 clear, max-age behavior.

## Codebase scan

### Required

| Area | Path | Why |
|------|------|-----|
| BE workflow | `.github/workflows/deploy-backend-ec2.yml` | Set/clear flag around deploy job |
| FE overlay | `components/DeploymentMaintenance.tsx` | Poll S3 status; remove staging disable |
| FE availability | `utils/apiAvailability.ts` | Replace `/health` overlay logic |
| FE API clients | `utils/apiFetch.ts`, `app/api.ts` | Stop 502/503 → overlay |
| FE provider | `app/[locale]/Provider.tsx` | Already mounts overlay — keep |
| Amplify env | Amplify console / `amplify.yml` docs | `NEXT_PUBLIC_DEPLOY_STATUS_BASE_URL` |

### Optional / out of scope unless requested

| Area | Why |
|------|-----|
| Amplify FE deploy hooks | D3: backend only |
| Nest `/health` endpoint itself | Still useful for ops/load balancers; just not for overlay |
| Grafana alerts for deploy | Separate observability |
| Unit tests for poll/max-age | Only if user asks for tests |
| Hebrew/English new keys | Reuse existing deployment messages |

### No change needed

| Area | Why |
|------|-----|
| Prisma / DB | Flag is not in DB |
| Report builder / Portfolio Health APIs | Unrelated; overlay is global shell |
| nginx maintenance HTML on EC2 | Separate server-side page; this plan is Amplify UI overlay |

## Testing strategy

| # | Requirement | How to verify |
|---|-------------|----------------|
| T1 | Overlay only during backend deploy | Push to staging → typecheck: no overlay → deploy job start: overlay → job end: reload and app works |
| T2 | Staging ≠ production | Staging deploy does not overlay `portal.archaser.com` |
| T3 | No false flash on Portfolio Health | Open Portfolio Health / heavy pages with API up: no overlay |
| T4 | Stuck flag expiry | Manually leave `deploying: true` with old `updatedAt` (>60m): no overlay |
| T5 | Cancelled deploy clears flag | Cancel deploy job mid-run: `if: always` clears; overlay goes away |
| T6 | Preview still works | `?previewMaintenance=1` shows overlay without a deploy |

## Plan improvements / risks

- **Cache:** CloudFront/S3 caching can delay clear — use short TTL or cache-bust query (`?_=timestamp`) on poll (same pattern as current health probe).
- **Concurrent staging + production deploys:** Separate files avoid clobbering (D6).
- **Shared EC2:** Flag is per env, not per machine — correct even when both stacks share one host.
- **Secrets:** Prefer GHA OIDC → AWS over long-lived keys in secrets.

## How to test (summary)

1. Confirm status URLs return JSON for staging and production.
2. Trigger a staging backend deploy; confirm overlay appears only after the Deploy-to-EC2 job starts.
3. After success/cancel, confirm overlay clears and the page reloads once.
4. On production host during a staging-only deploy, confirm no overlay.
5. Open Portfolio Health with no deploy running: no maintenance page.
