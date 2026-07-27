-- ============================================================
-- Migration: Remove redundant fields from ActivitiesTemplate
--            and account_id from ActivityTemplateLanguage
-- Date: 2026-02-28
--
-- Rationale:
--   ActivitiesTemplate.sms_content / email_content / whatsapp_content / email_subject
--     are redundant because all content is now stored per-language in
--     ActivityTemplateLanguage. Keeping them in sync is error-prone and they
--     are no longer read by the application.
--
--   ActivityTemplateLanguage.account_id is redundant because:
--     - The parent ActivitiesTemplate already carries account_id.
--     - Language rows are always owned by the same account as the template.
--
-- Steps:
--   Part A – ActivitiesTemplate
--     1. Drop content columns from ActivitiesTemplate
--
--   Part B – ActivityTemplateLanguage
--     2. Drop old unique constraint (includes account_id)
--     3. Drop indexes that reference account_id
--     4. Drop the FK constraint for account_id → Account
--     5. Drop the account_id column
--     6. Add new unique constraint on (template_id, language)
-- ============================================================

BEGIN;

-- ============================================================
-- PART A: ActivitiesTemplate — drop redundant content columns
-- ============================================================

ALTER TABLE "ActivitiesTemplate"
    DROP COLUMN IF EXISTS "sms_content",
    DROP COLUMN IF EXISTS "email_content",
    DROP COLUMN IF EXISTS "whatsapp_content",
    DROP COLUMN IF EXISTS "email_subject";

-- ============================================================
-- PART B: ActivityTemplateLanguage — drop redundant account_id
-- ============================================================

-- Step 1: Drop old unique constraint that references account_id
ALTER TABLE "ActivityTemplateLanguage"
    DROP CONSTRAINT IF EXISTS "ActivityTemplateLanguage_template_language_account_unique";

-- Step 2: Drop indexes referencing account_id
DROP INDEX IF EXISTS "idx_activity_template_language_customer_id";
DROP INDEX IF EXISTS "idx_activity_template_language_template_language_customer";

-- Step 3: Drop the FK constraint for account_id → Account
ALTER TABLE "ActivityTemplateLanguage"
    DROP CONSTRAINT IF EXISTS "ActivityTemplateLanguage_account_id_fkey";

-- Step 4: Drop the account_id column
ALTER TABLE "ActivityTemplateLanguage"
    DROP COLUMN IF EXISTS "account_id";

-- Step 5: Add new unique constraint on (template_id, language)
-- Uniqueness per-account is still guaranteed because each ActivitiesTemplate
-- belongs to one account, so (template_id, language) is already account-scoped.
ALTER TABLE "ActivityTemplateLanguage"
    ADD CONSTRAINT "ActivityTemplateLanguage_template_language_unique"
    UNIQUE ("template_id", "language");

COMMIT;
