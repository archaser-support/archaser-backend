-- ============================================================================
-- System Reports for Customer Unpaid Invoices
-- Generated: 2025-01-XX
-- Total Reports: 3
-- Context: customer_unpaid_invoices
-- ============================================================================
-- 
-- This script creates system reports for unpaid invoices that appear only
-- on the customer detail page (/app/customers/[customerId]).
--
-- Reports created:
-- 1. All Unpaid Invoices (status_id: 3, 13)
-- 2. Due Invoices (status_id: 13)
-- 3. Overdue Invoices (status_id: 3)
--
-- IMPORTANT NOTES:
-- 1. Execute this script on the database manually
-- 2. System reports are created/updated for ALL existing accounts
-- 3. "All Unpaid Invoices" is set as the default report (is_default = true)
-- 4. After running, regenerate Prisma client: npx prisma generate
-- 5. This script uses ON CONFLICT to handle existing reports gracefully
--    - If a report with the same (account_id, unique_name) exists, it will be UPDATED
--    - All report fields are updated: name, description, report_config, is_public,
--      is_system (set to true), is_default, context, modified_at, modified_by (set to NULL)
--    - created_at and created_by are preserved from the original record
-- ============================================================================

BEGIN;

-- Delete existing system reports for this context (optional - uncomment if needed)
-- DELETE FROM "Report" WHERE is_system = true AND context = 'customer_unpaid_invoices';

-- Report 1: All Unpaid Invoices (DEFAULT REPORT)
-- Includes both Due (13) and Overdue (3) invoices
-- This report is set as default (is_default = true) for all accounts
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
    'All Unpaid Invoices' as name,
    'all_unpaid_invoices' as unique_name,
    'All unpaid invoices (Due and Overdue)' as description,
    '{
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "id"},
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "status_id"},
            {"table": "Invoice", "field": "customer_amount"},
            {"table": "Invoice", "field": "customer_net_amount"},
            {"table": "Invoice", "field": "due_date"},
            {"table": "Invoice", "field": "customer_total_paid"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "customer_currency"}
        ],
        "filters": [
            {
                "table": "Invoice",
                "field": "status_id",
                "operator": "in",
                "value": [3, 13]
            },
            {
                "table": "Invoice",
                "field": "customer_outstanding_debt",
                "operator": "greater_than",
                "value": 0
            }
        ],
        "sorting": [
            {"field": "invoice_number", "direction": "DESC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    true as is_default,
    'customer_unpaid_invoices' as context,
    NOW() as created_at,
    NOW() as modified_at,
    NULL as created_by,
    NULL as modified_by
FROM 
    "Account" a
WHERE 
    a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name) 
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = true,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- Report 2: Due Invoices
-- Only invoices with status_id = 13 (Due)
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
    'Due Invoices' as name,
    'due_invoices' as unique_name,
    'Invoices that are due for payment' as description,
    '{
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "id"},
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "status_id"},
            {"table": "Invoice", "field": "customer_amount"},
            {"table": "Invoice", "field": "customer_net_amount"},
            {"table": "Invoice", "field": "due_date"},
            {"table": "Invoice", "field": "customer_total_paid"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "customer_currency"}
        ],
        "filters": [
            {
                "table": "Invoice",
                "field": "status_id",
                "operator": "equals",
                "value": 13
            },
            {
                "table": "Invoice",
                "field": "customer_outstanding_debt",
                "operator": "greater_than",
                "value": 0
            }
        ],
        "sorting": [
            {"field": "invoice_number", "direction": "DESC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    false as is_default,
    'customer_unpaid_invoices' as context,
    NOW() as created_at,
    NOW() as modified_at,
    NULL as created_by,
    NULL as modified_by
FROM 
    "Account" a
WHERE 
    a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name) 
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = false,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- Report 3: Overdue Invoices
-- Only invoices with status_id = 3 (Overdue)
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
    'Overdue Invoices' as name,
    'overdue_invoices' as unique_name,
    'Invoices that are overdue for payment' as description,
    '{
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "id"},
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "status_id"},
            {"table": "Invoice", "field": "customer_amount"},
            {"table": "Invoice", "field": "customer_net_amount"},
            {"table": "Invoice", "field": "due_date"},
            {"table": "Invoice", "field": "customer_total_paid"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "customer_currency"}
        ],
        "filters": [
            {
                "table": "Invoice",
                "field": "status_id",
                "operator": "equals",
                "value": 3
            },
            {
                "table": "Invoice",
                "field": "customer_outstanding_debt",
                "operator": "greater_than",
                "value": 0
            }
        ],
        "sorting": [
            {"field": "invoice_number", "direction": "DESC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    false as is_default,
    'customer_unpaid_invoices' as context,
    NOW() as created_at,
    NOW() as modified_at,
    NULL as created_by,
    NULL as modified_by
FROM 
    "Account" a
WHERE 
    a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name) 
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = false,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

COMMIT;

-- ============================================================================
-- End of System Reports Migration Script
-- ============================================================================
-- 
-- Verification queries:
-- 
-- Count reports created per account:
-- SELECT account_id, COUNT(*) as report_count
-- FROM "Report" 
-- WHERE context = 'customer_unpaid_invoices' AND is_system = true
-- GROUP BY account_id
-- ORDER BY account_id;
-- 
-- Check default report is set correctly:
-- SELECT account_id, name, unique_name, is_default 
-- FROM "Report" 
-- WHERE context = 'customer_unpaid_invoices' 
--   AND is_system = true 
--   AND unique_name = 'all_unpaid_invoices';
-- 
-- VERIFY is_system is updated correctly (should return 0 rows):
-- SELECT id, account_id, name, unique_name, is_system, is_default 
-- FROM "Report" 
-- WHERE context = 'customer_unpaid_invoices' 
--   AND is_system = false;
-- 
-- List all reports for a specific account:
-- SELECT id, name, unique_name, context, is_system, is_default 
-- FROM "Report" 
-- WHERE context = 'customer_unpaid_invoices' 
--   AND is_system = true 
--   AND account_id = <YOUR_ACCOUNT_ID>;
-- 
-- ============================================================================

