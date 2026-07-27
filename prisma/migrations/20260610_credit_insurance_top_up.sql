-- Migration: Credit insurance top-up feature
-- Enums, InsurancePolicy columns, CustomerTopUp table, trend + snapshot columns

-- 1. New enums (idempotent via IF NOT EXISTS is not possible for CREATE TYPE;
--    we check existence first in the runner script or just use a simple CREATE
--    that will error silently if run via the migration runner that stops on error).
--    Use DO block in a single statement:
CREATE TYPE "insurance_policy_kind" AS ENUM ('Primary', 'TopUp');

CREATE TYPE "customer_top_up_type" AS ENUM ('Fixed', 'Percentage');

-- 2. InsurancePolicy columns
ALTER TABLE "InsurancePolicy"
  ADD COLUMN IF NOT EXISTS "insurer_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "policy_kind" "insurance_policy_kind" NOT NULL DEFAULT 'Primary',
  ADD COLUMN IF NOT EXISTS "parent_insurance_policy_id" INTEGER REFERENCES "InsurancePolicy"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "allow_concurrent_top_ups" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "idx_insurance_policy_policy_kind" ON "InsurancePolicy"("policy_kind");

CREATE INDEX IF NOT EXISTS "idx_insurance_policy_parent" ON "InsurancePolicy"("parent_insurance_policy_id");

UPDATE "InsurancePolicy" SET "policy_kind" = 'Primary' WHERE "policy_kind" IS NULL;

-- 3. CustomerTopUp table
CREATE TABLE IF NOT EXISTS "CustomerTopUp" (
  "id" SERIAL PRIMARY KEY,
  "customer_id" INTEGER NOT NULL REFERENCES "Customer"(id) ON DELETE CASCADE,
  "insurance_policy_id" INTEGER NOT NULL REFERENCES "InsurancePolicy"(id) ON DELETE CASCADE,
  "top_up_type" "customer_top_up_type" NOT NULL DEFAULT 'Fixed',
  "top_up_value" DECIMAL(20,4) NOT NULL,
  "currency" VARCHAR(16),
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "notes" TEXT,
  "cancelled_at" TIMESTAMPTZ(6),
  "created_by" VARCHAR(255),
  "modified_by" VARCHAR(255),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_customer_top_up_customer_date" ON "CustomerTopUp"("customer_id", "start_date", "end_date");

CREATE INDEX IF NOT EXISTS "idx_customer_top_up_customer_policy" ON "CustomerTopUp"("customer_id", "insurance_policy_id");

CREATE INDEX IF NOT EXISTS "idx_customer_top_up_policy" ON "CustomerTopUp"("insurance_policy_id");

-- 4. CustomerPolicyTrend columns
ALTER TABLE "CustomerPolicyTrend"
  ADD COLUMN IF NOT EXISTS "top_up_total" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "effective_approved_limit" DECIMAL(20,4),
  ADD COLUMN IF NOT EXISTS "active_top_up_count" INTEGER;

-- 5. CreditDashboardDailySnapshot columns
ALTER TABLE "CreditDashboardDailySnapshot"
  ADD COLUMN IF NOT EXISTS "top_up_cover_total_amount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "customers_with_active_top_up_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "top_up_expiring_customer_count" INTEGER;
