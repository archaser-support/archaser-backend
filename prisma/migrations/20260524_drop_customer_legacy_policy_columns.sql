-- Phase 6: Remove legacy policy columns from Customer (source of truth is CustomerPolicy).
-- Prerequisites:
--   1) 20260517_customer_policy.sql backfill has been applied.
--   2) Application code deployed WITHOUT dual-write to Customer policy columns.
-- Run: psql "$DATABASE_URL" -f prisma/migrations/20260524_drop_customer_legacy_policy_columns.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Pre-flight: customers with policy payload on Customer but no active CP row
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    missing_active INTEGER;
    duplicate_active INTEGER;
BEGIN
    SELECT COUNT(*)::int INTO missing_active
    FROM "Customer" c
    WHERE (
        c.policy_id IS NOT NULL
        OR c.customer_number_policy IS NOT NULL
        OR c.approved_limit IS NOT NULL
        OR c.approved_limit_expiration_date IS NOT NULL
        OR c.limit_type IS NOT NULL
        OR c.max_payment_term IS NOT NULL
        OR c.max_allowed_mep IS NOT NULL
        OR c.reporting_days IS NOT NULL
        OR c.excluded_from_policy = true
        OR c.policy_exclusion_reason IS NOT NULL
        OR c.credit_score IS NOT NULL
        OR c.credit_score_input_date IS NOT NULL
        OR c.active_customer_since IS NOT NULL
        OR c.outdated_dcl = true
    )
    AND NOT EXISTS (
        SELECT 1 FROM "CustomerPolicy" cp
        WHERE cp.customer_id = c.id AND cp.is_active = true
    );

    IF missing_active > 0 THEN
        RAISE EXCEPTION
            'Aborting: % customer(s) have legacy policy data but no active CustomerPolicy row. Run backfill first.',
            missing_active;
    END IF;

    SELECT COUNT(*)::int INTO duplicate_active
    FROM (
        SELECT customer_id
        FROM "CustomerPolicy"
        WHERE is_active = true
        GROUP BY customer_id
        HAVING COUNT(*) > 1
    ) d;

    IF duplicate_active > 0 THEN
        RAISE EXCEPTION
            'Aborting: % customer(s) have more than one active CustomerPolicy row.',
            duplicate_active;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Sync any drift: active CustomerPolicy <- Customer (last mirror before drop)
-- ---------------------------------------------------------------------------
UPDATE "CustomerPolicy" cp
SET
    insurance_policy_id = c.policy_id,
    customer_number_policy = c.customer_number_policy,
    approved_limit = c.approved_limit,
    approved_limit_currency = c.approved_limit_currency,
    approved_limit_expiration_date = c.approved_limit_expiration_date,
    limit_type = c.limit_type,
    max_payment_term = c.max_payment_term,
    max_allowed_mep = c.max_allowed_mep,
    reporting_days = c.reporting_days,
    excluded_from_policy = COALESCE(c.excluded_from_policy, false),
    policy_exclusion_reason = c.policy_exclusion_reason,
    credit_score = c.credit_score,
    credit_score_input_date = c.credit_score_input_date,
    active_customer_since = c.active_customer_since,
    outdated_dcl = COALESCE(c.outdated_dcl, false),
    modified_at = NOW()
FROM "Customer" c
WHERE cp.customer_id = c.id
  AND cp.is_active = true;

-- ---------------------------------------------------------------------------
-- 3) Drop FK, index, and legacy columns on Customer
-- ---------------------------------------------------------------------------
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS customer_insurance_policy_id_fkey;

DROP INDEX IF EXISTS idx_customer_policy_id;

ALTER TABLE "Customer"
    DROP COLUMN IF EXISTS policy_id,
    DROP COLUMN IF EXISTS customer_number_policy,
    DROP COLUMN IF EXISTS approved_limit,
    DROP COLUMN IF EXISTS approved_limit_currency,
    DROP COLUMN IF EXISTS approved_limit_expiration_date,
    DROP COLUMN IF EXISTS limit_type,
    DROP COLUMN IF EXISTS max_payment_term,
    DROP COLUMN IF EXISTS max_allowed_mep,
    DROP COLUMN IF EXISTS reporting_days,
    DROP COLUMN IF EXISTS excluded_from_policy,
    DROP COLUMN IF EXISTS policy_exclusion_reason,
    DROP COLUMN IF EXISTS credit_score,
    DROP COLUMN IF EXISTS credit_score_input_date,
    DROP COLUMN IF EXISTS active_customer_since,
    DROP COLUMN IF EXISTS outdated_dcl;

-- ---------------------------------------------------------------------------
-- 4) Post-check: legacy columns must be gone
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Customer'
          AND column_name = 'policy_id'
    ) THEN
        RAISE EXCEPTION 'Column Customer.policy_id still exists after migration';
    END IF;
END $$;

COMMIT;
