-- Reporting breach start date on BillingConnector; drop skip-reporting-breach flags.
-- One-time seed: copy backfill_start_date when present (leave null otherwise).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260917_reporting_breach_start_date.sql

BEGIN;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "reporting_breach_start_date" DATE;

UPDATE "BillingConnector"
SET "reporting_breach_start_date" = "backfill_start_date"
WHERE "backfill_start_date" IS NOT NULL
  AND "reporting_breach_start_date" IS NULL;

ALTER TABLE "BillingConnector"
  DROP COLUMN IF EXISTS "skip_reporting_breach_on_backfill";

ALTER TABLE "CreditAsOfBackfillJob"
  DROP COLUMN IF EXISTS "skip_reporting_breach";

COMMIT;
