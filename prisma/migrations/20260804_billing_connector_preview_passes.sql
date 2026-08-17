-- Billing connector: per-entity preview go/no-go pass flags (no sample rows).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260804_billing_connector_preview_passes.sql

BEGIN;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "preview_passes" JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
