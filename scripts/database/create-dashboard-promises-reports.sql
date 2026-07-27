-- ============================================================================
-- System Report for Operation Dashboard Promises-to-Pay Details
-- Context: dashboard_promises
-- ============================================================================
--
-- Creates ONE system report for ALL accounts matching legacy promises list columns:
--   customer, customer #, promise amount, currency, promise date
-- (Legacy also showed agent from the Promise_to_pay activity; report path uses
-- membership filters for agent scope instead of an agent column.)
--
-- Locked KPI filters come from the dashboard promise filter contract (additionalFilters).
-- Agent / Activity.some membership is applied server-side on execute.
--
-- Report:
--   Dashboard Promises (dashboard_promises_default) — DEFAULT
--
-- IMPORTANT:
-- 1. Execute this script on the database manually
-- 2. Uses ON CONFLICT (account_id, unique_name) to upsert
-- 3. New accounts also receive these via ReportService.copy/sync from account 10013
-- ============================================================================

BEGIN;

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
    'Dashboard Promises' as name,
    'dashboard_promises_default' as unique_name,
    'Default columns for operation dashboard promises-to-pay details drills' as description,
    '{
        "tables": ["CustomerCollectionPeriod"],
        "fields": [
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "customer_number"},
            {"table": "CustomerCollectionPeriod", "field": "promise_to_pay_amount"},
            {"table": "CustomerCollectionPeriod", "field": "currency"},
            {"table": "CustomerCollectionPeriod", "field": "promise_to_pay_date"}
        ],
        "filters": [],
        "sorting": [
            {"field": "Customer.name", "direction": "ASC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    true as is_default,
    'dashboard_promises' as context,
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

COMMIT;
