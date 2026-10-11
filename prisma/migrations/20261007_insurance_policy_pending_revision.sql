-- ============================================================================
-- Migration Script: InsurancePolicy pending revision (future-dated save)
-- Generated: 2026-10-07
-- Context: insurance policy save confirm + future-dated pending revision
-- ============================================================================
--
-- One pending revision per Insurance Policy, stored on the row (no new table).
-- pending_effective_date: UTC calendar day the revision goes live.
-- pending_payload: full policy form snapshot (same body as the policy PUT).
-- Live policy columns stay unchanged until activation. Both NULL = no pending.
-- Existing rows stay NULL.
--
-- IMPORTANT NOTES:
-- 1. Prefer: npx prisma db execute --schema prisma/schema.prisma --file <this-file>
-- 2. Do NOT add top-level BEGIN;/COMMIT; (runner already wraps in a transaction)
-- 3. After schema changes, regenerate Prisma client: npx prisma generate
-- ============================================================================

ALTER TABLE "InsurancePolicy"
    ADD COLUMN IF NOT EXISTS pending_effective_date DATE,
    ADD COLUMN IF NOT EXISTS pending_payload JSONB,
    ADD COLUMN IF NOT EXISTS pending_created_at TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS pending_created_by VARCHAR;

-- ============================================================================
-- Verification queries:
--
-- SELECT id, policy_number, pending_effective_date, pending_created_by
-- FROM "InsurancePolicy" WHERE pending_effective_date IS NOT NULL;
-- ============================================================================
