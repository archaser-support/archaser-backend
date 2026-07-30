-- Billing connector: optional backfill start date (dated cutover).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260728_billing_connector_backfill_start_date.sql

BEGIN;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "backfill_start_date" DATE;

COMMIT;
