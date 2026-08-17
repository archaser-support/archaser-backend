-- Cache Priority field discovery per connector entity until re-discover.
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260803_connector_discovered_fields.sql

BEGIN;

ALTER TABLE "ConnectorFieldMapping"
  ADD COLUMN IF NOT EXISTS "discovered_headers" JSONB,
  ADD COLUMN IF NOT EXISTS "discovered_example_values" JSONB,
  ADD COLUMN IF NOT EXISTS "discovered_sample_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "discovered_at" TIMESTAMPTZ(6);

COMMIT;
