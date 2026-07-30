-- Billing connector: skip reporting_breach stamping during backfill writes.
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260728_billing_connector_skip_reporting_breach.sql

BEGIN;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "skip_reporting_breach_on_backfill" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
