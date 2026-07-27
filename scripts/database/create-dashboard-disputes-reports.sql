-- ============================================================================
-- System Report for Operation Dashboard Dispute Details
-- Context: dashboard_disputes
-- ============================================================================
--
-- Creates ONE system report for ALL accounts matching legacy dispute list columns:
--   customer, customer #, assignee, status, reason, created_at
-- closed_at retained for disputes-closed drills.
--
-- Locked KPI filters come from the dashboard dispute filter contract (additionalFilters).
-- Agent / owner / modified_by identity is applied server-side on execute.
--
-- Report:
--   Dashboard Disputes (dashboard_disputes_default) — DEFAULT
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
    'Dashboard Disputes' as name,
    'dashboard_disputes_default' as unique_name,
    'Default columns for operation dashboard dispute details drills' as description,
    '{
        "tables": ["Dispute"],
        "fields": [
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "customer_number"},
            {"table": "Dispute", "field": "assigned_to"},
            {"table": "Dispute", "field": "dispute_status"},
            {"table": "Dispute", "field": "dispute_reason"},
            {"table": "Dispute", "field": "created_at"},
            {"table": "Dispute", "field": "closed_at"}
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
    'dashboard_disputes' as context,
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
