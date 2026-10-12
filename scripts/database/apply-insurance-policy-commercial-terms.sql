-- ============================================================================
-- Add Primary-only commercial terms columns on InsurancePolicy.
-- Idempotent. Safe to re-run. Additive only (no drops / data rewrites).
--
-- Matches prisma/schema.prisma:
--   enum insurance_policy_product_type (TailorMade | Commodity)
--   InsurancePolicy commercial fields (all nullable)
--
-- Run (from backend repo root, against the target DB):
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/database/apply-insurance-policy-commercial-terms.sql
--
-- Or paste into your staging SQL client.
--
-- No BEGIN/COMMIT: prisma db execute (and many clients) already wrap
-- the file in a transaction; nested BEGIN causes
-- "there is already a transaction in progress".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Enum: insurance_policy_product_type
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'insurance_policy_product_type'
          AND n.nspname = 'public'
    ) THEN
        CREATE TYPE "insurance_policy_product_type" AS ENUM (
            'TailorMade',
            'Commodity'
        );
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) InsurancePolicy commercial-term columns (nullable = not set)
-- ---------------------------------------------------------------------------
ALTER TABLE "InsurancePolicy"
    ADD COLUMN IF NOT EXISTS "insured_percentage" DECIMAL(10, 3),
    ADD COLUMN IF NOT EXISTS "non_qualifying_loss_threshold" DECIMAL(20, 4),
    ADD COLUMN IF NOT EXISTS "minimum_premium" DECIMAL(20, 4),
    ADD COLUMN IF NOT EXISTS "minimum_premium_period_years" INTEGER,
    ADD COLUMN IF NOT EXISTS "aggregate_excess" DECIMAL(20, 4),
    ADD COLUMN IF NOT EXISTS "sdl_excess" DECIMAL(20, 4),
    ADD COLUMN IF NOT EXISTS "ncb_zero_claims_bonus_percent" DECIMAL(10, 3),
    ADD COLUMN IF NOT EXISTS "ncb_claims_ratio_threshold_percent" DECIMAL(10, 3),
    ADD COLUMN IF NOT EXISTS "ncb_up_to_threshold_bonus_percent" DECIMAL(10, 3),
    ADD COLUMN IF NOT EXISTS "product_type" "insurance_policy_product_type";
