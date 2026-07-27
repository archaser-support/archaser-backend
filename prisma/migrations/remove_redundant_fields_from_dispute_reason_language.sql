-- ============================================================
-- Migration: Remove redundant fields from DisputeReasonLanguage
-- Date: 2026-02-27
-- Description:
--   The `account_id` and `master_template` columns on
--   DisputeReasonLanguage are redundant because:
--     - account_id is already available via the parent DisputeReason
--       (DisputeReason.account_id) through the FK dispute_reason_id
--     - master_template is already captured on DisputeReason.master_template
--
--   Steps performed:
--   1. Drop dependent unique constraint (includes account_id)
--   2. Drop dependent indexes on account_id and master_template
--   3. Drop combined index that includes account_id
--   4. Drop the FK constraint for account_id → Account
--   5. Drop the two columns
--   6. Add a new unique constraint on (dispute_reason_id, language)
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- Step 1: Drop old unique constraint that references account_id
-- ----------------------------------------------------------------
ALTER TABLE "DisputeReasonLanguage"
    DROP CONSTRAINT IF EXISTS "DisputeReasonLanguage_reason_language_account_unique";

-- ----------------------------------------------------------------
-- Step 2: Drop indexes that reference the columns being removed
-- ----------------------------------------------------------------

-- Index on account_id alone
DROP INDEX IF EXISTS "idx_dispute_reason_language_customer_id";

-- Index on master_template alone
DROP INDEX IF EXISTS "idx_dispute_reason_language_master_template";

-- Composite index that included account_id
DROP INDEX IF EXISTS "idx_dispute_reason_language_reason_language_customer";

-- ----------------------------------------------------------------
-- Step 3: Drop the foreign key constraint for account_id → Account
-- (Prisma named this based on the @relation map in schema.prisma;
--  the default Prisma FK name follows the pattern below.
--  Use the exact constraint name from your DB if different.)
-- ----------------------------------------------------------------
ALTER TABLE "DisputeReasonLanguage"
    DROP CONSTRAINT IF EXISTS "DisputeReasonLanguage_account_id_fkey";

-- ----------------------------------------------------------------
-- Step 4: Drop the redundant columns
-- ----------------------------------------------------------------
ALTER TABLE "DisputeReasonLanguage"
    DROP COLUMN IF EXISTS "master_template",
    DROP COLUMN IF EXISTS "account_id";

-- ----------------------------------------------------------------
-- Step 5: Add a new unique constraint on (dispute_reason_id, language)
-- Now that account_id is gone, uniqueness is enforced through the
-- parent DisputeReason row (which already carries account_id).
-- A DisputeReason can only have one translation per language.
-- ----------------------------------------------------------------
ALTER TABLE "DisputeReasonLanguage"
    ADD CONSTRAINT "DisputeReasonLanguage_reason_language_unique"
    UNIQUE ("dispute_reason_id", "language");

COMMIT;
