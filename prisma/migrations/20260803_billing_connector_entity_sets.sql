-- Billing connector: per-entity Priority table overrides + cached EntitySet catalog.
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260803_billing_connector_entity_sets.sql

BEGIN;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "entity_sets" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "entity_set_catalog" JSONB;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "entity_set_catalog_fetched_at" TIMESTAMPTZ(6);

COMMIT;
