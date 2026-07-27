-- Customer.crn: optional company registration number (CRN / מספר ח.פ.).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260512_customer_crn.sql

BEGIN;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "crn" VARCHAR(255);

COMMIT;
