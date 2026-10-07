-- ============================================================================
-- Migration Script: CustomerPolicy.policy_change_end_date
-- Generated: 2026-10-06
-- Context: dated customer policy unassign (run-off)
-- ============================================================================
--
-- Nullable UTC calendar day: first day with no new invoices on this version.
-- Existing rows stay NULL (open-ended) until Remove policy is applied.
--
-- IMPORTANT NOTES:
-- 1. Prefer: npx prisma db execute --schema prisma/schema.prisma --file <this-file>
-- 2. Do NOT add top-level BEGIN;/COMMIT; (runner already wraps in a transaction)
-- 3. After schema changes, regenerate Prisma client: npx prisma generate
-- ============================================================================

ALTER TABLE "CustomerPolicy"
    ADD COLUMN IF NOT EXISTS policy_change_end_date DATE;

-- ============================================================================
-- Verification queries:
--
-- SELECT COUNT(*) FROM "CustomerPolicy" WHERE policy_change_end_date IS NOT NULL;
-- ============================================================================
