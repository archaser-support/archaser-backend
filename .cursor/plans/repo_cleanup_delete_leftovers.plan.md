---
name: Repo cleanup delete leftovers
overview: Second-pass cleanup after the quarantine sweep — delete scripts/_quarantine, frontend twin plans, broken npm scripts, and two leftover schema copies fully covered by Prisma migrations. No app-code rewrite.
todos:
  - id: delete-quarantine
    content: Delete backend/scripts/_quarantine/ (entire folder)
    status: completed
  - id: package-json-scripts
    content: Remove broken and quarantine-only npm scripts from backend/package.json
    status: completed
  - id: d9-schema-copies
    content: Delete the two leftover schema copies fully covered by Prisma migrations
    status: completed
  - id: fe-twin-plans
    content: Delete 7 frontend twin plans; keep 2 FE-only files
    status: completed
  - id: verify-cleanup
    content: Verify quarantine gone, npm scripts valid, prisma/migrations intact, keep-list files still present
    status: completed
isProject: true
---

# Repo cleanup — delete leftovers (second pass)

Follow-up to `.cursor/plans/repo_cleanup_full_sweep.plan.md` (move into quarantine, do not delete). This pass **deletes**.

**Do not implement until this plan is approved.** Do not commit unless asked.

## Decision log

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Scope | Quarantine scripts + leftover `scripts/database` SQL + old plan files (BE + FE copies). No app code. | Next pass after “move, don’t delete” |
| D2 | Quarantine | Delete `scripts/_quarantine/` from the repo. Remove npm scripts that point at it. Recover from git if needed. | ~76 files gone from working tree |
| D3 | `scripts/database/` | Keep re-run files. Delete one-shot schema SQL/TS already in `prisma/migrations/`. Never delete `prisma/migrations/`. | |
| D4 | Frontend plans | Delete twins that also exist on backend. Keep FE-only files. | Scan found **7** twins (grill said 8); keep **2** FE-only |
| D5 | Backend plans | Keep all real plans. Only delete true junk (`.b64`, empty). | Scan found **no** junk this round |
| D6 | Extra SQL folders | Same keep/delete rule for `scripts/datafixes/`, `scripts/sql/`, root one-shot SQL. Do **not** touch `scripts/testing/`, `scripts/deployment/`, `scripts/startup/`. | |
| D7 | Broken re-runnable datafixes | Keep on disk. Do not wire in `package.json`. Do not rewrite imports. | e.g. `scripts/datafixes/sync-customer-policy-exclusion-derived.ts` |
| D8 | Broken npm scripts | Remove any whose target file is missing or lives only in deleted quarantine. | See list below |
| D9 | Match rule | Conservative — delete leftover SQL/TS only when a Prisma migration clearly does the same schema change (same table/columns). Keep grants, report seeds, language templates, cron-job inserts, purge scripts, and anything unsure. | Almost no filename overlap with `prisma/migrations/` |
| D10 | Extra script folders | Leave this round (`development/`, `mock-data/`, `security/`, `translation/`, one-off `scripts/*.ts`). | Out of D1/D6 |
| D11 | Borderline one-shot TS | Keep `drop-legacy-payment-table.ts` and `migrate-timezone-to-iana.ts`. Only delete files whose change is **fully** covered by a Prisma migration SQL file. | Migration companions that also rewrite data/reports stay |

## Delete list (exact)

### 1. `backend/scripts/_quarantine/` (entire folder)

Delete the directory and everything under it (including `README.md`). Recover with git history if needed.

### 2. `backend/package.json` npm scripts to remove

| Script | Why |
|--------|-----|
| `fix:currency-corruption` | Target `scripts/database/fix-currency-corruption.ts` is **missing** |
| `fix:currency-corruption:dry-run` | Same missing file |
| `backfill:invoice-capacity-gap-amounts` | Target only in `_quarantine/` |
| `backfill:invoice-capacity-gap-amounts:dry` | Same |
| `datafix:customer-policy-capacity-gap` | Same |
| `datafix:customer-policy-capacity-gap:dry` | Same |
| `credit-reporting-sample-data:dry-run` | Same |
| `credit-reporting-sample-data:smoke` | Same |
| `credit-reporting-sample-data:verify` | Same |
| `debug:logs` | Same |
| `debug:logs:analyze` | Same |
| `debug:logs:clear` | Same |
| `debug:logs:tail` | Same |

**Keep (files exist):** `migrate:activity-keys`, `migrate:activity-keys:dry`, `check:currency-fallbacks`, and all Nest/dev/deploy/soak/openapi scripts.

### 3. Leftover schema copies fully covered by Prisma migrations (D9 + D11)

| Delete | Covered by |
|--------|------------|
| `scripts/database/add-customer-to-import-type-enum.ts` | `prisma/migrations/add_customer_to_import_type_enum.sql` (`ImportType` + `'Customer'`) |
| `scripts/database/add-credit-insurance-product-support.sql` | `prisma/migrations/20260412_credit_insurance_product.sql` section 0 (same `Account` / `RolePermission` columns **and** the same backfill `UPDATE`s) |

No other `scripts/database`, `scripts/datafixes`, or `scripts/sql` file met the “fully covered” bar this scan.

**Keep (borderline / unsure):**

- `scripts/database/drop-legacy-payment-table.ts` — migration DDL is commented; TS also rewrites reports
- `scripts/database/migrate-timezone-to-iana.ts` — data-mapping recipe; imports old frontend path
- `scripts/database/add-zero-limit-alert-fields.sql` — columns exist in `schema.prisma`, **no** matching migration SQL
- `scripts/database/add-parent-customer-field.ts` — no matching migration SQL
- `scripts/database/add-currency-rate-and-customer-gap-fields.sql` — different tables/columns than `20260531_customer_policy_gap_amounts.sql`
- All `*Activity-Templates.sql`, `create-dashboard-*.sql`, `grant-*.sql`, `add-billing-connector-sync-cron-job.sql`, `purge-test-accounts*.sql`, `run-migration.ts`

### 4. Frontend twin plans (D4)

Delete these **7** files under `frontend/.cursor/plans/` (same filename exists on backend):

- `account-10149-recon-virtual-close.plan.md`
- `billing-connector-paid-tolerance.plan.md`
- `custom_priority_table_pull.plan.md`
- `drop-legacy-payment-table.plan.md`
- `language-rtl-agents-followups.plan.md`
- `remove-lambda-cron-endpoint.plan.md`
- `sync-history-mongo.plan.md`

**Keep (FE-only):**

- `frontend/.cursor/plans/next-nest-screen-parity.plan.md`
- `frontend/.cursor/plans/billing-account-extensions.prd.md`

Do **not** copy this cleanup plan onto the frontend (that would create a new twin).

## Keep / do not touch

- `prisma/migrations/` (all files)
- Backend `.cursor/plans/` real plans (including this file and `repo_cleanup_full_sweep.plan.md`)
- `scripts/testing/`, `scripts/deployment/`, `scripts/startup/`
- `scripts/development/`, `scripts/mock-data/`, `scripts/security/`, `scripts/translation/`, other `scripts/*.ts` helpers
- `scripts/datafixes/` (keep on disk; do not add npm scripts; do not rewrite Nest imports)
- App code (`api/`, `packages/`, frontend app)

## Execution notes

- Delete files from the working tree (`rm` / `git rm`). Do not run `prisma migrate` / `db push`.
- Do not rewrite imports in leftover scripts.
- Do not add translations, styles, or tests.
- Backend is the plan source of truth; frontend only keeps FE-only plan files.

## Testing Strategy

No new automated test files (cleanup-only; tests out of scope unless requested). Verify by inspection after deletes.

### 1. Inventory / integrity checks (manual)

#### `scripts/_quarantine` gone; Prisma history intact

- **Purpose**: D2 delete happened; D3 “never delete migrations” held
- **Test Cases**:
  - `test ! -d backend/scripts/_quarantine`
  - `ls backend/prisma/migrations/*.sql` still lists the same migration set (including `20260826_drop_legacy_payment_table.sql`, `add_customer_to_import_type_enum.sql`, `20260412_credit_insurance_product.sql`)
  - Keep files still exist: `run-migration.ts`, `drop-legacy-payment-table.ts`, `migrate-timezone-to-iana.ts`, `English-Activity-Templates.sql`, `add-billing-connector-sync-cron-job.sql`

#### `package.json` scripts resolve

- **Purpose**: D8 — no npm script points at a missing file or `_quarantine`
- **Test Cases**:
  - `jq -r '.scripts | to_entries[] | .value' backend/package.json` contains no `scripts/_quarantine` and no `fix-currency-corruption`
  - Remaining local targets exist: `scripts/database/run-migration.ts`, `scripts/check-currency-fallbacks.js`, `scripts/startup/dev-microservices.sh`, soak/openapi/deploy paths

#### Frontend plans

- **Purpose**: D4 — twins gone; FE-only kept
- **Test Cases**:
  - The 7 twin filenames are absent under `frontend/.cursor/plans/`
  - `next-nest-screen-parity.plan.md` and `billing-account-extensions.prd.md` remain
  - Same 7 filenames still exist under `backend/.cursor/plans/`

## Codebase scan

### Required

- `backend/scripts/_quarantine/**` — delete (D2)
- `backend/package.json` — drop D8 scripts
- `backend/scripts/database/add-customer-to-import-type-enum.ts` — delete (D9/D11)
- `backend/scripts/database/add-credit-insurance-product-support.sql` — delete (D9/D11)
- `frontend/.cursor/plans/` — delete 7 twins listed above

### Optional / out of scope unless requested

- Extra folders from D10 (`development/`, `mock-data/`, `security/`, `translation/`, one-off `scripts/*.ts`)
- Rewriting broken datafixes to Nest Prisma imports (D7)
- Restoring `fix-currency-corruption.ts` from git
- Editing old plans that still mention `scripts/_quarantine/` (stale references in `drop-legacy-payment-table.plan.md`, `remove-lambda-cron-endpoint.plan.md`, `repo_cleanup_full_sweep.plan.md`)
- Unwiring `check:currency-fallbacks` (file exists; scans frontend `app/`/`pages/`/`server/` that are not in this backend repo)
- CI: `.github/workflows/sync-openapi-to-frontend.yml` does not invoke the scripts being removed

### No change needed

- `prisma/schema.prisma` and `prisma/migrations/`
- Nest services, frontend app, translations, theme
- `scripts/testing/`, `scripts/deployment/`, `scripts/startup/`
- `migrate:activity-keys*` npm scripts

## Plan improvements / risks

- **Grill said 8 FE twins; disk has 7.** Plan uses the scan list, not the old count.
- **`add-credit-insurance-product-support.sql` is a documented extract of migration section 0**, including backfills — fully covered, safe to delete.
- **`drop-legacy-payment-table.ts` is the runnable cutover** (reports + `DROP`). Keeping it is the conservative call; do not treat the commented migration DDL as a full substitute.
- **Recover quarantine:** `git log -- scripts/_quarantine` then `git checkout <commit> -- scripts/_quarantine`.
- **Stale plan text** that mentions `_quarantine` will be wrong after this pass — leave it unless asked (D5 keep real plans as-is).
