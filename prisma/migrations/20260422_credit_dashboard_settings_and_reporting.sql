-- Invoice fields for “mark as reported” (ref, comment, captured time).
-- Credit dashboard thresholds (window %, days) are defined in app code, not the DB.
-- Run: psql "$DATABASE_URL" -f prisma/migrations/20260422_credit_dashboard_settings_and_reporting.sql
--
BEGIN;

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "reporting_reference" VARCHAR(255);

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "reporting_comment" TEXT;

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "reporting_captured_at" TIMESTAMPTZ(6);

COMMIT;
