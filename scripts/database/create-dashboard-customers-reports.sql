-- ============================================================================
-- System Reports for Financial Dashboard Customer Chart-Details
-- Context: dashboard_customers
-- ============================================================================
--
-- Creates two system reports for ALL accounts.
-- Chart-details selects the family default by unique_name; locked KPI filters come from
-- the dashboard customer filter contract (additionalFilters).
--
-- Columns match the legacy fixed chart-details lists per family.
--
-- Reports:
-- 1. Dashboard Overdue Customers (dashboard_customers_overdue) — DEFAULT
--    Used by overdue-amount and overdue-customers
-- 2. Dashboard Active Customer Dynamics (dashboard_customers_active_dynamics)
--    Used by active-customers
--
-- Also removes the consolidated single default (dashboard_customers_default).
--
-- IMPORTANT:
-- 1. Execute this script on the database manually
-- 2. Uses ON CONFLICT (account_id, unique_name) to upsert
-- 3. New accounts also receive these via ReportService.copy/sync from account 10013
-- ============================================================================

BEGIN;

DELETE FROM "Report"
WHERE unique_name = 'dashboard_customers_default';

-- Report 1: Overdue Customers (DEFAULT for context)
-- Legacy list: customer, outstanding, days overdue, invoice count, category
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
    'Dashboard Overdue Customers' as name,
    'dashboard_customers_overdue' as unique_name,
    'Default columns for overdue customers / overdue amount chart-details drills' as description,
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "total_invoices_overdue"},
            {"table": "Customer", "field": "days_overdue"},
            {"table": "Customer", "field": "number_of_overdue_invoices"},
            {"table": "Customer", "field": "category"}
        ],
        "filters": [],
        "sorting": [
            {"field": "name", "direction": "ASC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    true as is_default,
    'dashboard_customers' as context,
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

-- Report 2: Active Customer Dynamics
-- Legacy list: customer, overdue status change, date — status change is KPI-computed;
-- closest report fields: name, collection_status, modified_at
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
    'Dashboard Active Customer Dynamics' as name,
    'dashboard_customers_active_dynamics' as unique_name,
    'Default columns for active-customers chart-details drills' as description,
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "collection_status"},
            {"table": "Customer", "field": "modified_at"}
        ],
        "filters": [],
        "sorting": [
            {"field": "name", "direction": "ASC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    false as is_default,
    'dashboard_customers' as context,
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
