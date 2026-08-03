# Script quarantine

## Purpose

This directory holds **legacy monolith-era scripts** that are not Nest-canonical.
They typically depend on `@/` path aliases, `pages/api`, `frontend/server`, or `cronManager`,
or are one-off debug / watch / connection-pool stress tooling that should not live on the
active Nest backend script path.

Files were **moved** here (not deleted) so they can be restored or rewritten later.

## Restore steps

1. Identify the quarantined path under `scripts/_quarantine/...`.
2. Move it back to the mirrored path under `scripts/` (strip the `_quarantine/` segment).
   Example: `scripts/_quarantine/debug/analyze-console-logs.ts` → `scripts/debug/analyze-console-logs.ts`.
3. If an npm script was retargeted in root `package.json`, point it back (or keep the `_quarantine` path).
4. Prefer rewriting imports to Nest packages (`@archaser/*`) before un-quarantining for regular use.

## Not Nest-canonical

Do not treat scripts here as part of the supported Nest API / worker / connectors workflow.
Keep using `scripts/openapi/`, `scripts/deployment/`, `inventory-fe-nest-routes.cjs`, and
`scripts/database/run-migration.ts` (and other non-quarantined runners) for day-to-day work.

## Moved paths

Total files moved: **75**.

### Top-level entries under `scripts/_quarantine/`

- `scripts/analyze-cron-logs.ts` → `scripts/_quarantine/analyze-cron-logs.ts`
- `scripts/analyze-due-activity-not-canceled.ts` → `scripts/_quarantine/analyze-due-activity-not-canceled.ts`
- `scripts/analyze-health-logs.ts` → `scripts/_quarantine/analyze-health-logs.ts`
- `scripts/analyze-logs-for-dashboard.ts` → `scripts/_quarantine/analyze-logs-for-dashboard.ts`
- `scripts/backfill-insurance-policy-trend-snapshots.ts` → `scripts/_quarantine/backfill-insurance-policy-trend-snapshots.ts`
- `scripts/backfill-invoice-capacity-gap-amounts.ts` → `scripts/_quarantine/backfill-invoice-capacity-gap-amounts.ts`
- `scripts/backfill-invoice-limit-assessment.ts` → `scripts/_quarantine/backfill-invoice-limit-assessment.ts`
- `scripts/backfill_all_customers.ts` → `scripts/_quarantine/backfill_all_customers.ts`
- `database/` (7 files)
  - `scripts/database/create-customer-filter-reports.ts` → `scripts/_quarantine/database/create-customer-filter-reports.ts`
  - `scripts/database/mark-system-reports.ts` → `scripts/_quarantine/database/mark-system-reports.ts`
  - `scripts/database/recalculate-all-gaps.ts` → `scripts/_quarantine/database/recalculate-all-gaps.ts`
  - `scripts/database/recalculate-parent-aggregations.ts` → `scripts/_quarantine/database/recalculate-parent-aggregations.ts`
  - `scripts/database/seed-cron-compute-customer-overdue-metrics.sql` → `scripts/_quarantine/database/seed-cron-compute-customer-overdue-metrics.sql`
  - `scripts/database/setup-internal-email-templates.sh` → `scripts/_quarantine/database/setup-internal-email-templates.sh`
  - `scripts/database/update-customer-reports-fields.ts` → `scripts/_quarantine/database/update-customer-reports-fields.ts`
- `datafixes/` (2 files)
  - `scripts/datafixes/recalculate-customers-by-number.ts` → `scripts/_quarantine/datafixes/recalculate-customers-by-number.ts`
  - `scripts/datafixes/repair-customer-policy-capacity-gap-amounts.ts` → `scripts/_quarantine/datafixes/repair-customer-policy-capacity-gap-amounts.ts`
- `debug/` (2 files)
  - `scripts/debug/README.md` → `scripts/_quarantine/debug/README.md`
  - `scripts/debug/analyze-console-logs.ts` → `scripts/_quarantine/debug/analyze-console-logs.ts`
- `development/` (1 files)
  - `scripts/development/dev-with-account-tests.sh` → `scripts/_quarantine/development/dev-with-account-tests.sh`
- `scripts/fix-invoice-statuses-and-recalculate.ts` → `scripts/_quarantine/fix-invoice-statuses-and-recalculate.ts`
- `scripts/migrate-logs-to-loki.ts` → `scripts/_quarantine/migrate-logs-to-loki.ts`
- `scripts/recalculate-customer-policy-gap-amounts.ts` → `scripts/_quarantine/recalculate-customer-policy-gap-amounts.ts`
- `scripts/reconcile-invoice-policy-gap-amounts.ts` → `scripts/_quarantine/reconcile-invoice-policy-gap-amounts.ts`
- `scripts/restamp-customer-limit-assessment.ts` → `scripts/_quarantine/restamp-customer-limit-assessment.ts`
- `scripts/test-inforu-status.js` → `scripts/_quarantine/test-inforu-status.js`
- `scripts/test-loki-transport.ts` → `scripts/_quarantine/test-loki-transport.ts`
- `testing/` (45 files)
  - `scripts/testing/checkpoints/credit-reporting-sample-data.json` → `scripts/_quarantine/testing/checkpoints/credit-reporting-sample-data.json`
  - `scripts/testing/cleanup-import-data.ts` → `scripts/_quarantine/testing/cleanup-import-data.ts`
  - `scripts/testing/credit-reporting-sample-data/accountBootstrap.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/accountBootstrap.ts`
  - `scripts/testing/credit-reporting-sample-data/checkpoint.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/checkpoint.ts`
  - `scripts/testing/credit-reporting-sample-data/cli.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/cli.ts`
  - `scripts/testing/credit-reporting-sample-data/constants.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/constants.ts`
  - `scripts/testing/credit-reporting-sample-data/creditScopedWipe.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/creditScopedWipe.ts`
  - `scripts/testing/credit-reporting-sample-data/customerOnboarding.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/customerOnboarding.ts`
  - `scripts/testing/credit-reporting-sample-data/dailyGapSync.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/dailyGapSync.ts`
  - `scripts/testing/credit-reporting-sample-data/dailyOverdueSync.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/dailyOverdueSync.ts`
  - `scripts/testing/credit-reporting-sample-data/dailySnapshots.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/dailySnapshots.ts`
  - `scripts/testing/credit-reporting-sample-data/dayLoop.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/dayLoop.ts`
  - `scripts/testing/credit-reporting-sample-data/finalPass.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/finalPass.ts`
  - `scripts/testing/credit-reporting-sample-data/fxRates.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/fxRates.ts`
  - `scripts/testing/credit-reporting-sample-data/invoiceCreation.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/invoiceCreation.ts`
  - `scripts/testing/credit-reporting-sample-data/invoiceSchedule.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/invoiceSchedule.ts`
  - `scripts/testing/credit-reporting-sample-data/limitAssessment.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/limitAssessment.ts`
  - `scripts/testing/credit-reporting-sample-data/plan.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/plan.ts`
  - `scripts/testing/credit-reporting-sample-data/postRunSummary.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/postRunSummary.ts`
  - `scripts/testing/credit-reporting-sample-data/repairKpis.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/repairKpis.ts`
  - `scripts/testing/credit-reporting-sample-data/resume.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/resume.ts`
  - `scripts/testing/credit-reporting-sample-data/scheduler.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/scheduler.ts`
  - `scripts/testing/credit-reporting-sample-data/topUpCreation.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/topUpCreation.ts`
  - `scripts/testing/credit-reporting-sample-data/topUpPlan.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/topUpPlan.ts`
  - `scripts/testing/credit-reporting-sample-data/types.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/types.ts`
  - `scripts/testing/credit-reporting-sample-data/verify.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/verify.ts`
  - `scripts/testing/credit-reporting-sample-data/window.ts` → `scripts/_quarantine/testing/credit-reporting-sample-data/window.ts`
  - `scripts/testing/generate-credit-reporting-sample-data.ts` → `scripts/_quarantine/testing/generate-credit-reporting-sample-data.ts`
  - `scripts/testing/preprocess-golden-import.ts` → `scripts/_quarantine/testing/preprocess-golden-import.ts`
  - `scripts/testing/priority-mock-server.ts` → `scripts/_quarantine/testing/priority-mock-server.ts`
  - `scripts/testing/regenerate-golden-expected-results.ts` → `scripts/_quarantine/testing/regenerate-golden-expected-results.ts`
  - `scripts/testing/run-cron-manager-local.ts` → `scripts/_quarantine/testing/run-cron-manager-local.ts`
  - `scripts/testing/run-golden-import-harness.ts` → `scripts/_quarantine/testing/run-golden-import-harness.ts`
  - `scripts/testing/setup-test-accounts.ts` → `scripts/_quarantine/testing/setup-test-accounts.ts`
  - `scripts/testing/simulate-concurrent-users.ts` → `scripts/_quarantine/testing/simulate-concurrent-users.ts`
  - `scripts/testing/stress-test-connection-pool.ts` → `scripts/_quarantine/testing/stress-test-connection-pool.ts`
  - `scripts/testing/test-concurrent-job-execution.ts` → `scripts/_quarantine/testing/test-concurrent-job-execution.ts`
  - `scripts/testing/test-connection-pool-during-cron.ts` → `scripts/_quarantine/testing/test-connection-pool-during-cron.ts`
  - `scripts/testing/test-connection-pool-fixes.sh` → `scripts/_quarantine/testing/test-connection-pool-fixes.sh`
  - `scripts/testing/test-connection-pool-status.ts` → `scripts/_quarantine/testing/test-connection-pool-status.ts`
  - `scripts/testing/test-execution-record-creation.ts` → `scripts/_quarantine/testing/test-execution-record-creation.ts`
  - `scripts/testing/watch-account-creation-tests.sh` → `scripts/_quarantine/testing/watch-account-creation-tests.sh`
  - `scripts/testing/watch-portal-tests.sh` → `scripts/_quarantine/testing/watch-portal-tests.sh`
  - `scripts/testing/workloads/DbOpsWorkload.ts` → `scripts/_quarantine/testing/workloads/DbOpsWorkload.ts`
  - `scripts/testing/workloads/RealisticWorkload.ts` → `scripts/_quarantine/testing/workloads/RealisticWorkload.ts`
- `utilities/` (1 files)
  - `scripts/utilities/testEmail.ts` → `scripts/_quarantine/utilities/testEmail.ts`
- `scripts/watch-all-unit-tests-simple.sh` → `scripts/_quarantine/watch-all-unit-tests-simple.sh`
- `scripts/watch-all-unit-tests.sh` → `scripts/_quarantine/watch-all-unit-tests.sh`

## `package.json` script changes

These npm scripts were **retargeted** to the quarantined paths (keys kept):

- `backfill:invoice-capacity-gap-amounts`: now runs `scripts/_quarantine/backfill-invoice-capacity-gap-amounts.ts` (was under `scripts/` without `_quarantine`)
- `backfill:invoice-capacity-gap-amounts:dry`: now runs `scripts/_quarantine/backfill-invoice-capacity-gap-amounts.ts` (was under `scripts/` without `_quarantine`)
- `datafix:customer-policy-capacity-gap`: now runs `scripts/_quarantine/datafixes/repair-customer-policy-capacity-gap-amounts.ts` (was under `scripts/` without `_quarantine`)
- `datafix:customer-policy-capacity-gap:dry`: now runs `scripts/_quarantine/datafixes/repair-customer-policy-capacity-gap-amounts.ts` (was under `scripts/` without `_quarantine`)
- `credit-reporting-sample-data:dry-run`: now runs `scripts/_quarantine/testing/generate-credit-reporting-sample-data.ts` (was under `scripts/` without `_quarantine`)
- `credit-reporting-sample-data:smoke`: now runs `scripts/_quarantine/testing/generate-credit-reporting-sample-data.ts` (was under `scripts/` without `_quarantine`)
- `credit-reporting-sample-data:verify`: now runs `scripts/_quarantine/testing/generate-credit-reporting-sample-data.ts` (was under `scripts/` without `_quarantine`)
- `debug:logs`: now runs `scripts/_quarantine/debug/analyze-console-logs.ts` (was under `scripts/` without `_quarantine`)
- `debug:logs:analyze`: now runs `scripts/_quarantine/debug/analyze-console-logs.ts` (was under `scripts/` without `_quarantine`)
- `debug:logs:clear`: now runs `scripts/_quarantine/debug/analyze-console-logs.ts` (was under `scripts/` without `_quarantine`)
- `debug:logs:tail`: now runs `scripts/_quarantine/debug/analyze-console-logs.ts` (was under `scripts/` without `_quarantine`)

Unchanged Nest/ops scripts (examples): `openapi:export`, `deploy:docker:*`,
`migrate:activity-keys`, `fix:currency-corruption`, `postinstall`, `check:currency-fallbacks`.

