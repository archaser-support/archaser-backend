-- Ensure CreditDashboardDailySnapshot has timestamp columns expected by the app.
-- Safe when the table was created from an older script without these columns
-- (CREATE TABLE IF NOT EXISTS does not add missing columns).
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations/20260428_credit_dashboard_daily_snapshots_add_timestamps.sql

BEGIN;

ALTER TABLE "CreditDashboardDailySnapshot"
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

ALTER TABLE "CreditDashboardDailySnapshot"
    ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

ALTER TABLE "CreditDashboardDailySnapshot"
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(128);

ALTER TABLE "CreditDashboardDailySnapshot"
    ADD COLUMN IF NOT EXISTS modified_by VARCHAR(128);

COMMIT;
