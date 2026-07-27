-- Billing connector: account feature flag, connector config, per-entity sync state.
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260623_billing_connector.sql

BEGIN;

DO $$ BEGIN
  CREATE TYPE "BillingProvider" AS ENUM ('PRIORITY', 'SAP_BUSINESS_ONE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ConnectorAuthType" AS ENUM ('API_KEY', 'OAUTH2_CLIENT_CREDENTIALS', 'BASIC');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ConnectorSyncMode" AS ENUM ('BACKFILL', 'INCREMENTAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingConnectorStatus" AS ENUM ('Active', 'Disabled', 'Error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BillingConnector" (
  "id" SERIAL PRIMARY KEY,
  "account_id" INTEGER NOT NULL UNIQUE,
  "provider" "BillingProvider" NOT NULL DEFAULT 'PRIORITY',
  "status" "BillingConnectorStatus" NOT NULL DEFAULT 'Disabled',
  "base_url" VARCHAR(500),
  "auth_type" "ConnectorAuthType" NOT NULL DEFAULT 'API_KEY',
  "credentials_encrypted" TEXT,
  "sync_enabled" BOOLEAN NOT NULL DEFAULT false,
  "sync_cron_expression" VARCHAR(100) NOT NULL DEFAULT '0 */6 * * *',
  "sync_mode" "ConnectorSyncMode" NOT NULL DEFAULT 'BACKFILL',
  "enabled_entities" JSONB NOT NULL DEFAULT '["Customer", "Contact", "Invoice", "Payment"]'::jsonb,
  "sync_overlap_minutes" INTEGER NOT NULL DEFAULT 5,
  "backfill_max_pages_per_run" INTEGER NOT NULL DEFAULT 50,
  "backfill_max_duration_seconds" INTEGER NOT NULL DEFAULT 600,
  "backfill_import_batch_size" INTEGER NOT NULL DEFAULT 20,
  "consecutive_auth_failures" INTEGER NOT NULL DEFAULT 0,
  "backfill_started_at" TIMESTAMPTZ(6),
  "last_connection_test_at" TIMESTAMPTZ(6),
  "last_connection_error" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "created_by" VARCHAR,
  "modified_by" VARCHAR,
  CONSTRAINT "BillingConnector_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_billing_connector_account_id"
  ON "BillingConnector" ("account_id");
CREATE INDEX IF NOT EXISTS "idx_billing_connector_status"
  ON "BillingConnector" ("status");

CREATE TABLE IF NOT EXISTS "ConnectorSyncState" (
  "id" SERIAL PRIMARY KEY,
  "connector_id" INTEGER NOT NULL,
  "entity_type" "ImportType" NOT NULL,
  "backfill_completed" BOOLEAN NOT NULL DEFAULT false,
  "backfill_completed_at" TIMESTAMPTZ(6),
  "backfill_cursor" VARCHAR(500),
  "backfill_records_pulled" INTEGER NOT NULL DEFAULT 0,
  "backfill_last_checkpoint_at" TIMESTAMPTZ(6),
  "backfill_window_end" TIMESTAMPTZ(6),
  "backfill_total_records" INTEGER,
  "last_max_updated_at" TIMESTAMPTZ(6),
  "last_successful_run_at" TIMESTAMPTZ(6),
  "last_attempt_at" TIMESTAMPTZ(6),
  "last_error" VARCHAR(500),
  CONSTRAINT "ConnectorSyncState_connector_id_fkey"
    FOREIGN KEY ("connector_id") REFERENCES "BillingConnector"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "unique_connector_entity_sync_state" UNIQUE ("connector_id", "entity_type")
);

CREATE INDEX IF NOT EXISTS "idx_connector_sync_state_connector_id"
  ON "ConnectorSyncState" ("connector_id");

COMMIT;
