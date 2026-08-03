---
name: Repo cleanup full sweep
overview: Full-sweep cleanup — untrack Nest build output, backend as plan source of truth (prune FE mirrors + delete plan junk), quarantine legacy monolith scripts under scripts/_quarantine/ without deleting them.
todos:
  - id: phase1-dist-gitignore
    content: Fix backend .gitignore; git rm --cached api/dist and packages/database/dist
    status: completed
  - id: phase2-plans
    content: Delete BE plan junk; delete 86 FE twin plans; add short ownership note
    status: completed
  - id: phase3-scripts-quarantine
    content: Create scripts/_quarantine + README; move legacy scripts; comment/retarget package.json
    status: completed
  - id: verify-cleanup
    content: Verify ignore, plan dirs, quarantine inventory, package.json scripts
    status: completed
isProject: true
---

# Repo cleanup — dist, plans, scripts quarantine

## Decision log

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Scope | Full sweep | Dist + plans ownership + scripts quarantine |
| D2 | Plan ownership | Backend = source of truth; FE keeps FE-only only | Stop dual mirrors |
| D3 | FE prune | Delete every FE plan/PRD whose filename exists on backend | Today: **86 twins**, **0 FE-only** → FE `.cursor/plans/` becomes empty |
| D4 | Backend plans | Delete junk only (`*.prd.b64`, `*.qa.md`); keep real plans | Nest archive later |
| D5 | Dist | Fix `.gitignore` + `git rm --cached` for `api/dist/` and `packages/database/dist/` | Keep files on disk |
| D6 | Scripts | Move legacy into `scripts/_quarantine/` + README; fix/comment `package.json` | No deletes |
| D7 | `.agents/` | Out of scope | Grill later |

## Phase 1 — Stop tracking Nest build output (backend)

In `backend/.gitignore`:

- Add split-repo paths: `api/dist/`, `packages/database/dist/`
- Keep or remove dead monorepo paths (`backend/api/dist/`, etc.)

Then:

```bash
git rm -r --cached api/dist packages/database/dist
```

Do **not** delete folders from disk.

Optional: fix stale monorepo paths in `frontend/.gitignore` for consistency.

## Phase 2 — Plans

### Backend junk delete

- `.cursor/plans/credit-only-no-automation-ux.prd.b64`
- `.cursor/plans/credit-insurance-top-up.qa.md`

Leave all real `*.plan.md` / `*.prd.md` in place.

### Frontend twin prune

Delete all **86** files under `frontend/.cursor/plans/` that share a filename with backend. After this, FE plans dir is empty (0 FE-only today) — expected under D2/D3.

### Ownership note

Short note in cursor quick-ref: implementation plans/PRDs live in **backend** `.cursor/plans/`; frontend only adds UI/i18n/design-only plans with filenames not present on backend.

## Phase 3 — Scripts quarantine (backend)

Create `scripts/_quarantine/README.md`.

### Selection rule (move, do not delete)

Move under `_quarantine/` (preserve relative structure) when any of:

1. Imports `@/`, `pages/api`, or `frontend/server` / monolith `cronManager`
2. Lives under `scripts/debug/`
3. Is `watch-*-tests*.sh` / `dev-with-account-tests.sh` targeting pages/api
4. Obvious one-offs: `utilities/testEmail.ts`, `run-cron-manager-local.ts`, connection-pool stress / concurrent cronManager tests, `test-inforu-status.js`, root `analyze-*-logs.ts` one-offs

**Keep in place:** Nest cutover helpers — `inventory-fe-nest-routes.cjs`, `scripts/openapi/`, `scripts/deployment/`, useful prisma runners.

**package.json:** Comment out or retarget npm scripts whose targets move. Document new paths in quarantine README.

Known wired scripts likely affected: `credit-reporting-sample-data:*`, `debug:logs*`, some `backfill:*` / `datafix:*`.

Frontend `scripts/` — no change.

## Verification

1. `git check-ignore -v api/dist/...` hits ignore
2. Dist not in `git status` after Nest build
3. FE plans empty; BE junk gone; BE real plans remain
4. `scripts/_quarantine` populated + README; broken npm scripts commented/retargeted

## Codebase scan

### Required
- `backend/.gitignore`, `git rm --cached api/dist` + `packages/database/dist`
- BE junk deletes; FE twin deletes (86)
- `scripts/_quarantine/` + README + moves; `backend/package.json`

### Optional / out of scope
- `.agents/` (D7), Nest plan archive, deleting quarantined scripts, rewriting to Nest imports

### No change needed
- `api/src/email/**`, Prisma schema, translations, styling

## Notes
- Empty FE `.cursor/plans/` after prune is correct.
- Quarantining credit-reporting-sample-data pauses those npm scripts until Nest rewrite — intentional.
- Do not commit unless user asks.
