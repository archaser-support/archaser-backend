-- ============================================================================
-- System Report for Operation Dashboard Activity Details
-- Context: dashboard_activities
-- ============================================================================
--
-- Creates ONE system report for ALL accounts (union of legacy activity list columns).
-- Locked KPI filters come from the dashboard activity filter contract (additionalFilters).
-- Agent / system / portal identity is applied server-side on execute.
--
-- Legacy lists covered:
--   manual/system/portal/success: customer, customer #, agent, title, type, status, created_at
--   total-calls: + outcome, call_time, call_direction
--
-- Report:
--   Dashboard Activities (dashboard_activities_default) — DEFAULT
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
    'Dashboard Activities' as name,
    'dashboard_activities_default' as unique_name,
    'Default columns for operation dashboard activity details drills' as description,
    '{
        "tables": ["Activity"],
        "fields": [
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "customer_number"},
            {"table": "Activity", "field": "created_by"},
            {"table": "Activity", "field": "title"},
            {"table": "Activity", "field": "type"},
            {"table": "Activity", "field": "status"},
            {"table": "Activity", "field": "call_outcome"},
            {"table": "Activity", "field": "call_time"},
            {"table": "Activity", "field": "call_direction"},
            {"table": "Activity", "field": "created_at"}
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
    'dashboard_activities' as context,
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
