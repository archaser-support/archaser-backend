-- Credit insurance product: enums, InsurancePolicy, InsurancePolicyCountry, Customer + Invoice columns,
-- migrate oldest_invoice_overdue_date from CustomerCollectionPeriod to Customer, drop column from collection period.
--
-- Review and run against your environment (psql or admin tool). Idempotent where possible.
-- Prisma schema: prisma/schema.prisma
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations/20260412_credit_insurance_product.sql
--
-- Includes Account / RolePermission product columns (same as
-- scripts/database/add-credit-insurance-product-support.sql) so Prisma
-- Account.has_collection and related queries match the DB in one run.

BEGIN;

-- =============================================================================
-- 0. Account + RolePermission product flags (Prisma)
-- =============================================================================

ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS has_collection boolean NOT NULL DEFAULT true;

ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS has_credit_insurance boolean NOT NULL DEFAULT false;

ALTER TABLE "RolePermission"
ADD COLUMN IF NOT EXISTS is_collection boolean NOT NULL DEFAULT true;

ALTER TABLE "RolePermission"
ADD COLUMN IF NOT EXISTS is_credit_insurance boolean NOT NULL DEFAULT false;

UPDATE "Account"
SET has_collection = true
WHERE has_collection IS DISTINCT FROM true;

UPDATE "Account"
SET has_credit_insurance = false
WHERE has_credit_insurance IS DISTINCT FROM false;

UPDATE "RolePermission"
SET is_collection = true,
    is_credit_insurance = false
WHERE is_collection IS DISTINCT FROM true
   OR is_credit_insurance IS DISTINCT FROM false;

UPDATE "RolePermission"
SET is_credit_insurance = true
WHERE role IN (
    'CFO',
    'Data_Analyst',
    'System_Administrator'
)
  AND is_credit_insurance IS DISTINCT FROM true;

-- =============================================================================
-- 1. Enums (match Prisma)
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "customer_limit_type" AS ENUM ('DCL', 'Named');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "invoice_reported_status" AS ENUM ('Reported', 'Acknowledge_Received');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- 2. InsurancePolicy
-- =============================================================================

CREATE TABLE IF NOT EXISTS "InsurancePolicy" (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  account_id INTEGER NOT NULL,
  policy_number VARCHAR(255) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  currency VARCHAR(16),
  max_total_cover DECIMAL(20, 4),
  min_credit_score DECIMAL(10, 2),
  score_validity_period_months INTEGER,
  max_dcl DECIMAL(20, 4),
  status "record_status" NOT NULL DEFAULT 'Active'::"record_status",
  created_by VARCHAR,
  modified_by VARCHAR,
  CONSTRAINT "insurance_policy_account_id_fkey"
    FOREIGN KEY (account_id) REFERENCES "Account"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "InsurancePolicyCreatedBy_fkey"
    FOREIGN KEY (created_by) REFERENCES "User"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "InsurancePolicyModifiedBy_fkey"
    FOREIGN KEY (modified_by) REFERENCES "User"(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "unique_insurance_policy_account_policy_number"
  ON "InsurancePolicy"(account_id, policy_number);

CREATE INDEX IF NOT EXISTS "idx_insurance_policy_account_id" ON "InsurancePolicy"(account_id);
CREATE INDEX IF NOT EXISTS "idx_insurance_policy_created_by" ON "InsurancePolicy"(created_by);
CREATE INDEX IF NOT EXISTS "idx_insurance_policy_modified_by" ON "InsurancePolicy"(modified_by);
CREATE INDEX IF NOT EXISTS "idx_insurance_policy_status" ON "InsurancePolicy"(status);

-- =============================================================================
-- 3. InsurancePolicyCountry
-- =============================================================================

CREATE TABLE IF NOT EXISTS "InsurancePolicyCountry" (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  insurance_policy_id INTEGER NOT NULL,
  country_id INTEGER NOT NULL,
  payment_term_cap INTEGER,
  country_mep INTEGER,
  reporting_days INTEGER,
  country_max_limit DECIMAL(20, 4),
  created_by VARCHAR,
  modified_by VARCHAR,
  CONSTRAINT "insurance_policy_country_policy_id_fkey"
    FOREIGN KEY (insurance_policy_id) REFERENCES "InsurancePolicy"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "insurance_policy_country_country_id_fkey"
    FOREIGN KEY (country_id) REFERENCES "Country"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "InsurancePolicyCountryCreatedBy_fkey"
    FOREIGN KEY (created_by) REFERENCES "User"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "InsurancePolicyCountryModifiedBy_fkey"
    FOREIGN KEY (modified_by) REFERENCES "User"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "unique_insurance_policy_country" UNIQUE (insurance_policy_id, country_id)
);

CREATE INDEX IF NOT EXISTS "idx_insurance_policy_country_policy_id" ON "InsurancePolicyCountry"(insurance_policy_id);
CREATE INDEX IF NOT EXISTS "idx_insurance_policy_country_created_by" ON "InsurancePolicyCountry"(created_by);
CREATE INDEX IF NOT EXISTS "idx_insurance_policy_country_modified_by" ON "InsurancePolicyCountry"(modified_by);

-- =============================================================================
-- 4. Customer — new columns + FK to InsurancePolicy
-- =============================================================================

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS policy_id INTEGER;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS approved_limit DECIMAL(20, 4);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS limit_type "customer_limit_type";
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS max_payment_term INTEGER;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS max_allowed_mep INTEGER;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS reporting_days INTEGER;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS oldest_invoice_overdue_date TIMESTAMP(6);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS overdue_breach BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS excluded_from_policy BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS policy_exclusion_reason TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_insurance_policy_id_fkey'
  ) THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT "customer_insurance_policy_id_fkey"
      FOREIGN KEY (policy_id) REFERENCES "InsurancePolicy"(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_customer_policy_id" ON "Customer"(policy_id);

-- =============================================================================
-- 5. Data fix: copy oldest overdue date from collection periods to Customer
-- =============================================================================

UPDATE "Customer" c
SET oldest_invoice_overdue_date = agg.mx
FROM (
  SELECT customer_id, MAX(oldest_invoice_overdue_date) AS mx
  FROM "CustomerCollectionPeriod"
  WHERE oldest_invoice_overdue_date IS NOT NULL
  GROUP BY customer_id
) agg
WHERE c.id = agg.customer_id
  AND (c.oldest_invoice_overdue_date IS DISTINCT FROM agg.mx);

-- =============================================================================
-- 6. Drop oldest_invoice_overdue_date from CustomerCollectionPeriod
-- =============================================================================

ALTER TABLE "CustomerCollectionPeriod" DROP COLUMN IF EXISTS oldest_invoice_overdue_date;

-- =============================================================================
-- 7. Invoice — credit insurance columns + indexes
-- =============================================================================

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS payment_term INTEGER;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS target_reporting_date DATE;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS actual_reporting_date DATE;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS target_mep_date DATE;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS reported_status "invoice_reported_status";
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS reporting_breach BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "idx_invoice_status_target_mep_date" ON "Invoice"(status, target_mep_date);
CREATE INDEX IF NOT EXISTS "idx_invoice_status_target_reporting_date" ON "Invoice"(status, target_reporting_date);

COMMIT;
