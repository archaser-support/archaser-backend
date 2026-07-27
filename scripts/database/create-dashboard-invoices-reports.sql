-- ============================================================================
-- System Reports for Financial Dashboard Invoice Chart-Details
-- Context: dashboard_invoices
-- ============================================================================
--
-- Creates four system reports (overdue / aging / due / maturity) for ALL accounts.
-- Chart-details selects the family default by unique_name; locked KPI filters come from
-- the dashboard invoice filter contract (additionalFilters), not from these configs.
--
-- Columns match the legacy fixed chart-details lists per family.
--
-- Reports:
-- 1. Dashboard Overdue Invoices (dashboard_invoices_overdue) — DEFAULT
-- 2. Dashboard Aging Portfolio (dashboard_invoices_aging)
-- 3. Dashboard Due Invoices (dashboard_invoices_due)
-- 4. Dashboard Maturity Schedule (dashboard_invoices_maturity)
--
-- Also removes the consolidated single default (dashboard_invoices_default).
--
-- IMPORTANT:
-- 1. Execute this script on the database manually
-- 2. Uses ON CONFLICT (account_id, unique_name) to upsert
-- 3. New accounts also receive these via ReportService.copy/sync from account 10013
-- ============================================================================

BEGIN;

DELETE FROM "Report"
WHERE unique_name = 'dashboard_invoices_default';

-- Report 1: Overdue Invoices (DEFAULT for context)
-- Legacy list: invoice #, customer, outstanding, days overdue
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
    'Dashboard Overdue Invoices' as name,
    'dashboard_invoices_overdue' as unique_name,
    'Default columns for overdue invoices chart-details drills' as description,
    '{
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "days_overdue"}
        ],
        "filters": [],
        "sorting": [
            {"field": "invoice_number", "direction": "ASC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    true as is_default,
    'dashboard_invoices' as context,
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

-- Report 2: Aging Portfolio
-- Legacy list: invoice #, customer, invoice amount, overdue invoice amount, days overdue
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
    'Dashboard Aging Portfolio' as name,
    'dashboard_invoices_aging' as unique_name,
    'Default columns for aging portfolio chart-details drills' as description,
    '{
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Invoice", "field": "customer_amount"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "days_overdue"}
        ],
        "filters": [],
        "sorting": [
            {"field": "invoice_number", "direction": "ASC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    false as is_default,
    'dashboard_invoices' as context,
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

-- Report 3: Due Invoices
-- Legacy list: invoice #, customer, due amount, days until due
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
    'Dashboard Due Invoices' as name,
    'dashboard_invoices_due' as unique_name,
    'Default columns for due invoices chart-details drills' as description,
    '{
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "days_until_due"}
        ],
        "filters": [],
        "sorting": [
            {"field": "invoice_number", "direction": "ASC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    false as is_default,
    'dashboard_invoices' as context,
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

-- Report 4: Maturity Schedule
-- Legacy list: invoice #, customer, due amount, days until due, original amount
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
    'Dashboard Maturity Schedule' as name,
    'dashboard_invoices_maturity' as unique_name,
    'Default columns for receivables maturity schedule chart-details drills' as description,
    '{
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "days_until_due"},
            {"table": "Invoice", "field": "customer_amount"}
        ],
        "filters": [],
        "sorting": [
            {"field": "invoice_number", "direction": "ASC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    false as is_default,
    'dashboard_invoices' as context,
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
