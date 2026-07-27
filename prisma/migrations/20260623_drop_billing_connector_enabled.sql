-- Drop unused Account.billing_connector_enabled (tab is permission-gated only).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260623_drop_billing_connector_enabled.sql

BEGIN;

ALTER TABLE "Account"
  DROP COLUMN IF EXISTS "billing_connector_enabled";

COMMIT;
