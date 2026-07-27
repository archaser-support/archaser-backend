-- Customer.customer_number_policy: optional alphanumeric id as on the insurance policy.
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260419_customer_number_policy.sql

BEGIN;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "customer_number_policy" VARCHAR(255);

COMMIT;
