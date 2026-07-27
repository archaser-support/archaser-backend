-- ============================================================================
-- Create and Copy System Reports for Customer Contacts, Banks, and Disputes
-- Generated: 2025-01-XX
-- Source Account: 10013
-- Contexts: customer_contacts, customer_banks, disputes
-- ============================================================================
-- 
-- This script:
-- 1. Creates/updates system reports for customer contacts, banks, and disputes contexts in account_id 10013
-- 2. Copies these reports to all other accounts in the system
--
-- Reports created/updated:
-- - customer_contacts: "All Contacts" (default), "Active Contacts" (system)
-- - customer_banks: "All customer banks" (default)
-- - disputes: "All open disputes" (default), "My open disputes" (system)
--
-- IMPORTANT NOTES:
-- 1. Execute this script on the database manually (DBeaver)
-- 2. Run ROLLBACK; if you see transaction errors
-- 3. After running, regenerate Prisma client: npx prisma generate
-- 4. unique_name is generated using pattern: {context}_{report_name_snake_case}
-- 5. System reports use NULL for created_by and modified_by
-- 6. This script uses ON CONFLICT to handle existing reports gracefully
--    - If a report with the same (account_id, unique_name) exists, it will be UPDATED
--    - All report fields are updated: name, description, report_config, is_public,
--      is_system (set to true), is_default, context, modified_at, modified_by (set to NULL)
-- 7. Only non-deleted accounts are included in the copy operation
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 0: Add full_name column to Contact table and backfill data
-- ============================================================================
-- This step:
-- 1. Adds the full_name column to the Contact table if it doesn't exist
-- 2. Backfills full_name for all existing contacts
-- Uses DO block with exception handling to prevent transaction abort
DO $$
BEGIN
    -- Check if full_name column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'Contact' 
        AND column_name = 'full_name'
    ) THEN
        -- Add the full_name column
        ALTER TABLE "Contact" 
        ADD COLUMN full_name VARCHAR;
        
        RAISE NOTICE 'Added full_name column to Contact table';
    ELSE
        RAISE NOTICE 'full_name column already exists. Skipping column creation.';
    END IF;
    
    -- Backfill full_name for existing contacts (now that we know column exists or was just created)
    UPDATE "Contact"
    SET full_name = TRIM(CONCAT(first_name, ' ', COALESCE(NULLIF(last_name, ''), '')))
    WHERE full_name IS NULL OR full_name = '';
    
    RAISE NOTICE 'Backfilled full_name for existing contacts';
EXCEPTION
    WHEN OTHERS THEN
        -- If column creation failed, try to continue with backfill if column exists
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public'
            AND table_name = 'Contact' 
            AND column_name = 'full_name'
        ) THEN
            BEGIN
                UPDATE "Contact"
                SET full_name = TRIM(CONCAT(first_name, ' ', COALESCE(NULLIF(last_name, ''), '')))
                WHERE full_name IS NULL OR full_name = '';
                RAISE NOTICE 'Backfilled full_name for existing contacts (after error)';
            EXCEPTION
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error backfilling full_name: %', SQLERRM;
            END;
        ELSE
            RAISE NOTICE 'Error adding full_name column: %. Column does not exist.', SQLERRM;
        END IF;
END $$;

-- ============================================================================
-- STEP 1: Create System Reports in Account 10013
-- ============================================================================

-- Customer Contacts Reports
-- Report: All Contacts (Default)
-- Note: Contact.id is required as the first field for delete/edit operations
-- The ReportExecutionService formats this as "Contact.id" in the output
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
) VALUES (
    10013,
    'All Contacts',
    'customer_contacts_all_contacts',
    'All contacts for this customer',
    '{"tables":["Contact"],"fields":[{"table":"Contact","field":"id"},{"table":"Contact","field":"status","width":100,"flex":0,"minWidth":100},{"table":"Contact","field":"full_name"},{"table":"Contact","field":"role"},{"table":"Contact","field":"email"},{"table":"Contact","field":"mobile"},{"table":"Contact","field":"phone"},{"table":"Contact","field":"receives_standard_reminder"},{"table":"Contact","field":"receives_escalated_reminder"}],"filters":[],"sorting":[{"field":"full_name","direction":"ASC"}],"grouping":[]}'::jsonb,
    true,
    true,
    true,
    'customer_contacts',
    NOW(),
    NOW(),
    NULL,
    NULL
) ON CONFLICT (account_id, unique_name) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = EXCLUDED.is_default,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- Report: Active Contacts (System)
-- Note: Contact.id is required as the first field for delete/edit operations
-- The ReportExecutionService formats this as "Contact.id" in the output
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
) VALUES (
    10013,
    'Active Contacts',
    'customer_contacts_active_contacts',
    'Active contacts only',
    '{"tables":["Contact"],"fields":[{"table":"Contact","field":"id"},{"table":"Contact","field":"status","width":100,"flex":0,"minWidth":100},{"table":"Contact","field":"full_name"},{"table":"Contact","field":"role"},{"table":"Contact","field":"email"},{"table":"Contact","field":"mobile"},{"table":"Contact","field":"phone"},{"table":"Contact","field":"receives_standard_reminder"},{"table":"Contact","field":"receives_escalated_reminder"}],"filters":[{"table":"Contact","field":"status","operator":"equals","value":1}],"sorting":[{"field":"full_name","direction":"ASC"}],"grouping":[]}'::jsonb,
    true,
    true,
    false,
    'customer_contacts',
    NOW(),
    NOW(),
    NULL,
    NULL
) ON CONFLICT (account_id, unique_name) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = EXCLUDED.is_default,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- Customer Banks Reports
-- Report: All customer banks (Default)
-- Note: CustomerBanks table is joined to AccountBankAccounts via customer_bank_account_id
-- Fields are accessed via the join: AccountBankAccounts.bank_name, etc.
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
) VALUES (
    10013,
    'All customer banks',
    'customer_banks_all_accounts',
    'All bank accounts for this customer',
    '{"tables":["CustomerBanks","AccountBankAccounts","Country"],"joins":[{"type":"LEFT","from":"CustomerBanks","to":"AccountBankAccounts","on":"CustomerBanks.customer_bank_account_id = AccountBankAccounts.id"},{"type":"LEFT","from":"AccountBankAccounts","to":"Country","on":"AccountBankAccounts.country_id = Country.id"}],"fields":[{"table":"CustomerBanks","field":"id"},{"table":"CustomerBanks","field":"customer_bank_account_id"},{"table":"AccountBankAccounts","field":"bank_name"},{"table":"Country","field":"name","alias":"country"},{"table":"AccountBankAccounts","field":"city"},{"table":"AccountBankAccounts","field":"account_number"},{"table":"AccountBankAccounts","field":"beneficiary_name"}],"filters":[],"sorting":[{"field":"bank_name","direction":"ASC"}],"grouping":[]}'::jsonb,
    true,
    true,
    true,
    'customer_banks',
    NOW(),
    NOW(),
    NULL,
    NULL
) ON CONFLICT (account_id, unique_name) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = EXCLUDED.is_default,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- Dispute Reports
-- Report: All open disputes (Default)
-- Update existing report to include Dispute.id field
UPDATE "Report"
SET 
    report_config = CASE
        WHEN NOT EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(report_config->'fields') AS field
            WHERE field->>'table' = 'Dispute' AND field->>'field' = 'id'
        )
        THEN jsonb_set(
            report_config,
            '{fields}',
            jsonb_build_array(
                jsonb_build_object('table', 'Dispute', 'field', 'id')
            ) || (report_config->'fields')
        )
        ELSE report_config  -- Already has id, don't modify
    END,
    modified_at = NOW(),
    modified_by = NULL
WHERE 
    account_id = 10013
    AND is_system = true
    AND context = 'disputes'
    AND name = 'All open disputes';

-- Report: My open disputes (System)
-- Update existing report to include Dispute.id field
UPDATE "Report"
SET 
    report_config = CASE
        WHEN NOT EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(report_config->'fields') AS field
            WHERE field->>'table' = 'Dispute' AND field->>'field' = 'id'
        )
        THEN jsonb_set(
            report_config,
            '{fields}',
            jsonb_build_array(
                jsonb_build_object('table', 'Dispute', 'field', 'id')
            ) || (report_config->'fields')
        )
        ELSE report_config  -- Already has id, don't modify
    END,
    modified_at = NOW(),
    modified_by = NULL
WHERE 
    account_id = 10013
    AND is_system = true
    AND context = 'disputes'
    AND name = 'My open disputes';

-- ============================================================================
-- STEP 2: Copy System Reports from Account 10013 to All Other Accounts
-- ============================================================================

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
    -- Source reports: system reports from account 10013 with customer_contacts, customer_banks, or disputes context
    r.account_id = 10013
    AND r.is_system = true
    AND r.context IN ('customer_contacts', 'customer_banks', 'disputes')
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
-- Check if Active Contacts report has the correct filter:
-- SELECT 
--     name,
--     context,
--     report_config->'filters' as filters,
--     jsonb_array_elements(report_config->'filters') as filter_details
-- FROM "Report"
-- WHERE context = 'customer_contacts'
--   AND name = 'Active Contacts'
--   AND is_system = true
--   AND account_id = 10013;
-- 
-- Check if filter value is a number (should return 1 row with value = 1):
-- SELECT 
--     name,
--     (filter->>'value')::int as filter_value,
--     filter->>'operator' as operator,
--     filter->>'field' as field
-- FROM "Report",
--      jsonb_array_elements(report_config->'filters') as filter
-- WHERE context = 'customer_contacts'
--   AND name = 'Active Contacts'
--   AND is_system = true
--   AND account_id = 10013
--   AND filter->>'field' = 'status';
-- 
-- ============================================================================
-- Verification queries:
-- 
-- Check created reports in account 10013:
-- SELECT id, name, unique_name, context, is_system, is_default 
-- FROM "Report" 
-- WHERE account_id = 10013 
--   AND context IN ('customer_contacts', 'customer_banks', 'disputes')
--   AND is_system = true
-- ORDER BY context, name;
-- 
-- Count reports copied per account (should show same count for all accounts):
-- SELECT account_id, context, COUNT(*) as report_count
-- FROM "Report" 
-- WHERE context IN ('customer_contacts', 'customer_banks', 'disputes') 
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
-- WHERE r1.context IN ('customer_contacts', 'customer_banks', 'disputes') 
--   AND r1.is_system = true
--   AND r1.account_id != 10013
-- GROUP BY r1.unique_name, r1.name, r1.context
-- HAVING COUNT(DISTINCT r1.account_id) != (SELECT COUNT(*) FROM "Account" WHERE deleted_at IS NULL AND id != 10013);
-- 
-- List all reports for a specific account (replace <ACCOUNT_ID> with actual ID):
-- SELECT id, name, unique_name, context, is_system, is_default 
-- FROM "Report" 
-- WHERE context IN ('customer_contacts', 'customer_banks', 'disputes') 
--   AND is_system = true 
--   AND account_id = <ACCOUNT_ID>
-- ORDER BY context, name;
-- 
-- Verify is_system is set correctly (should return 0 rows):
-- SELECT id, account_id, name, unique_name, is_system 
-- FROM "Report" 
-- WHERE context IN ('customer_contacts', 'customer_banks', 'disputes') 
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
--   AND r1.context IN ('customer_contacts', 'customer_banks', 'disputes')
--   AND r1.is_system = true
-- ORDER BY r1.context, r1.name;
-- 
-- ============================================================================

