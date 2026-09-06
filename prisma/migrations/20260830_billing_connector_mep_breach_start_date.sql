-- Billing connector: optional MEP breach start date (UTC calendar day, null = no gate).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260830_billing_connector_mep_breach_start_date.sql

BEGIN;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "mep_breach_start_date" DATE;

COMMIT;
