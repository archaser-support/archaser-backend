-- ConnectorFieldMapping: per-entity ERP field mappings for billing connectors.
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260623_connector_field_mapping.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "ConnectorFieldMapping" (
  "id" SERIAL PRIMARY KEY,
  "connector_id" INTEGER NOT NULL,
  "import_type" "ImportType" NOT NULL,
  "mapping" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "is_complete" BOOLEAN NOT NULL DEFAULT false,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "modified_by" VARCHAR,
  CONSTRAINT "ConnectorFieldMapping_connector_id_fkey"
    FOREIGN KEY ("connector_id") REFERENCES "BillingConnector"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "unique_connector_field_mapping" UNIQUE ("connector_id", "import_type")
);

CREATE INDEX IF NOT EXISTS "idx_connector_field_mapping_connector_id"
  ON "ConnectorFieldMapping" ("connector_id");

COMMIT;
