-- Optional per-entity OData date column for connector window filters.
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260825_connector_mapping_pull_date_field.sql

BEGIN;

ALTER TABLE "ConnectorFieldMapping"
  ADD COLUMN IF NOT EXISTS pull_date_field VARCHAR(100);

COMMIT;
