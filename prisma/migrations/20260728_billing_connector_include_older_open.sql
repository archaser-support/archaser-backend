-- Billing connector: include older open invoices when start date is set.
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260728_billing_connector_include_older_open.sql

BEGIN;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "include_older_open_invoices" BOOLEAN NOT NULL DEFAULT true;

COMMIT;
