-- Drop synthetic user audit columns from cron-written daily snapshot tables.
-- Retain created_at / modified_at for row timing.
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations/20260629_snapshot_drop_audit_columns.sql

BEGIN;

ALTER TABLE "CustomerPolicyTrend"
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS modified_by;

ALTER TABLE "InsurancePolicyTrend"
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS modified_by;

ALTER TABLE "InsurancePolicyCountryTrend"
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS modified_by;

ALTER TABLE "NamedPolicyTrend"
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS modified_by;

ALTER TABLE "CreditDashboardDailySnapshot"
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS modified_by;

COMMIT;
