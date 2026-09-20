-- Drop unused BillingConnector.status (eligibility is sync_enabled only).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260916_drop_billing_connector_status.sql

BEGIN;

DROP INDEX IF EXISTS "idx_billing_connector_status";

ALTER TABLE "BillingConnector" DROP COLUMN IF EXISTS "status";

DROP TYPE IF EXISTS "BillingConnectorStatus";

COMMIT;
