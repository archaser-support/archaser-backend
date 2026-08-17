-- Billing connector: per-entity pull filters (OData / rule builder).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260803_billing_connector_pull_filters.sql

BEGIN;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "pull_filters" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "pull_filters_cleanup_pending" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "pull_filters_cleanup_entities" JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
