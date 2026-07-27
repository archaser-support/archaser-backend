-- ============================================================================
-- System Reports for Financial Dashboard Payment Chart-Details
-- Context: dashboard_payments
-- ============================================================================
--
-- Report:
--   Dashboard Collected MTD (dashboard_payments_collected_mtd) — DEFAULT
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
    'Dashboard Collected MTD' as name,
    'dashboard_payments_collected_mtd' as unique_name,
    'Default columns for collected-mtd chart-details drills' as description,
    '{
        "tables": ["InvoicePayment"],
        "fields": [
            {"table": "InvoicePayment", "field": "payment_date"},
            {"table": "InvoicePayment", "field": "amount"},
            {"table": "InvoicePayment", "field": "customer_amount"},
            {"table": "InvoicePayment", "field": "invoice_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Invoice", "field": "status"},
            {"table": "InvoicePayment", "field": "customer_currency"}
        ],
        "filters": [],
        "sorting": [
            {"field": "payment_date", "direction": "ASC"}
        ],
        "grouping": []
    }'::jsonb as report_config,
    true as is_public,
    true as is_system,
    true as is_default,
    'dashboard_payments' as context,
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
