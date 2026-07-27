-- CustomerPolicy history table + Invoice.policy_id + backfill from Customer.
-- Run: psql "$DATABASE_URL" -f prisma/migrations/20260517_customer_policy.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "CustomerPolicy" (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    customer_id INTEGER NOT NULL,
    insurance_policy_id INTEGER,
    customer_number_policy VARCHAR(255),
    approved_limit DECIMAL(20, 4),
    approved_limit_currency VARCHAR(16),
    approved_limit_expiration_date DATE,
    limit_type "customer_limit_type",
    max_payment_term INTEGER,
    max_allowed_mep INTEGER,
    reporting_days INTEGER,
    excluded_from_policy BOOLEAN NOT NULL DEFAULT false,
    policy_exclusion_reason TEXT,
    credit_score DECIMAL(10, 2),
    credit_score_input_date DATE,
    active_customer_since DATE,
    outdated_dcl BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_by VARCHAR,
    modified_by VARCHAR,
    CONSTRAINT customer_policy_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES "Customer"(id) ON DELETE CASCADE,
    CONSTRAINT customer_policy_insurance_policy_id_fkey
        FOREIGN KEY (insurance_policy_id) REFERENCES "InsurancePolicy"(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_policy_customer_id
    ON "CustomerPolicy" (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_policy_insurance_policy_id
    ON "CustomerPolicy" (insurance_policy_id);
CREATE INDEX IF NOT EXISTS idx_customer_policy_customer_active
    ON "CustomerPolicy" (customer_id, is_active);

-- One active row per customer
CREATE UNIQUE INDEX IF NOT EXISTS unique_customer_policy_one_active
    ON "CustomerPolicy" (customer_id)
    WHERE is_active = true;

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS policy_id INTEGER;

DO $$ BEGIN
    ALTER TABLE "Invoice"
        ADD CONSTRAINT invoice_insurance_policy_id_fkey
        FOREIGN KEY (policy_id) REFERENCES "InsurancePolicy"(id);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_policy_id ON "Invoice" (policy_id);

-- Backfill CustomerPolicy from Customer (idempotent)
INSERT INTO "CustomerPolicy" (
    customer_id,
    insurance_policy_id,
    customer_number_policy,
    approved_limit,
    approved_limit_currency,
    approved_limit_expiration_date,
    limit_type,
    max_payment_term,
    max_allowed_mep,
    reporting_days,
    excluded_from_policy,
    policy_exclusion_reason,
    credit_score,
    credit_score_input_date,
    active_customer_since,
    outdated_dcl,
    is_active,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT
    c.id AS customer_id,
    c.policy_id AS insurance_policy_id,
    c.customer_number_policy,
    c.approved_limit,
    c.approved_limit_currency,
    c.approved_limit_expiration_date,
    c.limit_type,
    c.max_payment_term,
    c.max_allowed_mep,
    c.reporting_days,
    COALESCE(c.excluded_from_policy, false) AS excluded_from_policy,
    c.policy_exclusion_reason,
    c.credit_score,
    c.credit_score_input_date,
    c.active_customer_since,
    COALESCE(c.outdated_dcl, false) AS outdated_dcl,
    true AS is_active,
    COALESCE(c.created_at, NOW()) AS created_at,
    COALESCE(c.modified_at, NOW()) AS modified_at,
    c.created_by,
    c.modified_by
FROM "Customer" c
WHERE (
    c.policy_id IS NOT NULL OR
    c.customer_number_policy IS NOT NULL OR
    c.approved_limit IS NOT NULL OR
    c.approved_limit_expiration_date IS NOT NULL OR
    c.limit_type IS NOT NULL OR
    c.max_payment_term IS NOT NULL OR
    c.max_allowed_mep IS NOT NULL OR
    c.reporting_days IS NOT NULL OR
    c.excluded_from_policy = true OR
    c.policy_exclusion_reason IS NOT NULL OR
    c.credit_score IS NOT NULL OR
    c.credit_score_input_date IS NOT NULL OR
    c.active_customer_since IS NOT NULL OR
    c.outdated_dcl = true
)
AND NOT EXISTS (
    SELECT 1
    FROM "CustomerPolicy" cp
    WHERE cp.customer_id = c.id
      AND cp.is_active = true
);

-- Populate Invoice.policy_id from customer active policy at migration time
UPDATE "Invoice" i
SET policy_id = c.policy_id
FROM "Customer" c
WHERE i.customer_id = c.id
  AND i.policy_id IS NULL
  AND c.policy_id IS NOT NULL;

-- Validation (informational)
SELECT COUNT(*) AS active_customer_policy_rows
FROM "CustomerPolicy"
WHERE is_active = true;

SELECT COUNT(*) AS missing_migrations
FROM "Customer" c
WHERE (
    c.policy_id IS NOT NULL OR
    c.customer_number_policy IS NOT NULL OR
    c.approved_limit IS NOT NULL OR
    c.approved_limit_expiration_date IS NOT NULL OR
    c.limit_type IS NOT NULL OR
    c.max_payment_term IS NOT NULL OR
    c.max_allowed_mep IS NOT NULL OR
    c.reporting_days IS NOT NULL OR
    c.excluded_from_policy = true OR
    c.policy_exclusion_reason IS NOT NULL OR
    c.credit_score IS NOT NULL OR
    c.credit_score_input_date IS NOT NULL OR
    c.active_customer_since IS NOT NULL OR
    c.outdated_dcl = true
)
AND NOT EXISTS (
    SELECT 1
    FROM "CustomerPolicy" cp
    WHERE cp.customer_id = c.id
      AND cp.is_active = true
);

SELECT customer_id, COUNT(*) AS active_rows
FROM "CustomerPolicy"
WHERE is_active = true
GROUP BY customer_id
HAVING COUNT(*) > 1;

COMMIT;
