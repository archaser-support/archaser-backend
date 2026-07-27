-- Customer: credit_score and credit_score_input_date (matches prisma/schema.prisma Customer model).
--
-- credit_score: optional numeric score (same precision as InsurancePolicy.min_credit_score).
-- credit_score_input_date: optional calendar date; set by application when score changes.
--
-- Idempotent (IF NOT EXISTS). Review and run against your environment.
-- Example: psql "$DATABASE_URL" -f prisma/migrations/20260413_customer_credit_score_fields.sql

BEGIN;

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS credit_score DECIMAL(10, 2);

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS credit_score_input_date DATE;

COMMIT;
