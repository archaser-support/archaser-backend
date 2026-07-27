-- If you already applied a version of 20260422 that added Account credit dashboard
-- columns, run this once to align the DB with Prisma (thresholds are in app code only).
-- Safe to run if columns do not exist.
--
BEGIN;

ALTER TABLE "Account" DROP COLUMN IF EXISTS "credit_dashboard_reporting_window_days";
ALTER TABLE "Account" DROP COLUMN IF EXISTS "credit_dashboard_limit_warn_threshold_pct";
ALTER TABLE "Account" DROP COLUMN IF EXISTS "credit_dashboard_score_validity_warn_days";

COMMIT;
