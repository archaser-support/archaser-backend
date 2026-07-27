-- ============================================================================
-- Copy System Reports from Account 10013 to All Other Accounts
-- Generated: 2025-01-XX
-- Source Account: 10013
-- Contexts: customers, disputes
-- ============================================================================
-- 
-- This script copies system reports for "customers" and "disputes" contexts
-- from account_id 10013 to all other accounts in the system.
--
-- Reports copied:
-- - All system reports from account 10013 where context IN ('customers', 'disputes')
-- - Each report is copied to all other accounts (excluding account 10013)
--
-- IMPORTANT NOTES:
-- 1. Execute this script on the database manually (DBeaver)
-- 2. Run ROLLBACK; if you see transaction errors
-- 3. After running, regenerate Prisma client: npx prisma generate
-- 4. This script uses ON CONFLICT to handle existing reports gracefully
--    - If a report with the same (account_id, unique_name) exists, it will be UPDATED
--    - All report fields are updated: name, description, report_config, is_public,
--      is_system (set to true), is_default, context, modified_at, modified_by (set to NULL)
--    - created_at and created_by are preserved from the original record if it exists,
--      otherwise set to NOW() and NULL respectively
-- 5. Only non-deleted accounts are included in the copy operation
-- ============================================================================

BEGIN;

-- Copy system reports from account 10013 to all other accounts
-- This uses INSERT ... SELECT with CROSS JOIN to create reports for all accounts
INSERT INTO "Report" (
    account_id,
    name,
    unique_name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT 
    a.id as account_id,
    r.name,
    r.unique_name,
    r.description,
    r.report_config,
    r.is_public,
    true as is_system,  -- Ensure is_system is set to true
    r.is_default,
    r.context,
    NOW() as created_at,
    NOW() as modified_at,
    NULL as created_by,
    NULL as modified_by
FROM 
    "Account" a
CROSS JOIN 
    "Report" r
WHERE 
    -- Source reports: system reports from account 10013 with customers or disputes context
    r.account_id = 10013
    AND r.is_system = true
    AND r.context IN ('customers', 'disputes')
    -- Target accounts: all accounts except 10013 and deleted accounts
    AND a.id != 10013
    AND a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name) 
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,  -- Always ensure is_system is true
    is_default = EXCLUDED.is_default,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;
    -- Note: created_at and created_by are preserved from existing record
    -- They are only set for new records (when no conflict occurs)
    -- Note: Since account 10013 has only one default per context, the copy operation
    -- will preserve that, ensuring only one default per context per account

COMMIT;

-- ============================================================================
-- Verification queries:
-- 
-- Count reports copied per account (should show same count for all accounts):
-- SELECT account_id, context, COUNT(*) as report_count
-- FROM "Report" 
-- WHERE context IN ('customers', 'disputes') 
--   AND is_system = true
-- GROUP BY account_id, context
-- ORDER BY account_id, context;
-- 
-- Check that all accounts have the same reports as account 10013:
-- SELECT 
--     r1.unique_name,
--     r1.name,
--     r1.context,
--     COUNT(DISTINCT r1.account_id) as account_count,
--     (SELECT COUNT(*) FROM "Account" WHERE deleted_at IS NULL AND id != 10013) as expected_accounts
-- FROM "Report" r1
-- WHERE r1.context IN ('customers', 'disputes') 
--   AND r1.is_system = true
--   AND r1.account_id != 10013
-- GROUP BY r1.unique_name, r1.name, r1.context
-- HAVING COUNT(DISTINCT r1.account_id) != (SELECT COUNT(*) FROM "Account" WHERE deleted_at IS NULL AND id != 10013);
-- 
-- List all reports for a specific account (replace <ACCOUNT_ID> with actual ID):
-- SELECT id, name, unique_name, context, is_system, is_default 
-- FROM "Report" 
-- WHERE context IN ('customers', 'disputes') 
--   AND is_system = true 
--   AND account_id = <ACCOUNT_ID>
-- ORDER BY context, name;
-- 
-- Verify is_system is set correctly (should return 0 rows):
-- SELECT id, account_id, name, unique_name, is_system 
-- FROM "Report" 
-- WHERE context IN ('customers', 'disputes') 
--   AND is_system = false;
-- 
-- Compare reports between account 10013 and another account:
-- SELECT 
--     r1.unique_name,
--     r1.name as name_10013,
--     r2.name as name_other,
--     r1.context,
--     r1.is_default as default_10013,
--     r2.is_default as default_other
-- FROM "Report" r1
-- LEFT JOIN "Report" r2 ON r1.unique_name = r2.unique_name AND r2.account_id = <OTHER_ACCOUNT_ID>
-- WHERE r1.account_id = 10013
--   AND r1.context IN ('customers', 'disputes')
--   AND r1.is_system = true
-- ORDER BY r1.context, r1.name;
-- 
-- ============================================================================

