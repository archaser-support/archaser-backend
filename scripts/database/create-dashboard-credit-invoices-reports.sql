-- ============================================================================
-- System Reports for Credit Dashboard Invoice Detail Lists
-- Context: dashboard_credit_invoices
-- ============================================================================
--
-- Creates system reports for ALL accounts:
-- 1. terms
-- 2. reporting
-- 3. reported
--
-- Columns match the legacy EndlessScroll lists per type.
--
-- IMPORTANT:
-- 1. Execute this script on the database manually
-- 2. Uses ON CONFLICT (account_id, unique_name) to upsert
-- 3. New accounts also receive these via ReportService.copy/sync from account 10013
-- ============================================================================

BEGIN;

-- 1. Terms Breach (DEFAULT for context)
-- Legacy: policy, customer, invoice, terms breach reason, invoice amount
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Terms Breach',
    'dashboard_credit_invoices_terms',
    'Default columns for credit dashboard terms breach detail list',
    '{
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "terms_breach_reason"},
            {"table": "Invoice", "field": "customer_outstanding_debt"}
        ],
        "filters": [],
        "sorting": [{"field": "invoice_number", "direction": "ASC"}],
        "grouping": []
    }'::jsonb,
    true, true, true, 'dashboard_credit_invoices',
    NOW(), NOW(), NULL, NULL
FROM "Account" a
WHERE a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = true,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- 2. Reporting Countdown
-- Legacy: policy, customer, invoice, invoice amount, days overdue, days left for reporting
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Reporting Countdown',
    'dashboard_credit_invoices_reporting',
    'Default columns for credit dashboard reporting countdown detail list',
    '{
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "days_overdue"},
            {"table": "Invoice", "field": "days_left_for_reporting"}
        ],
        "filters": [],
        "sorting": [{"field": "target_reporting_date", "direction": "ASC"}],
        "grouping": []
    }'::jsonb,
    true, true, false, 'dashboard_credit_invoices',
    NOW(), NOW(), NULL, NULL
FROM "Account" a
WHERE a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = false,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- 3. Reported Invoices
-- Legacy: policy, customer, invoice, invoice amount, reporting date, reported at, ref/comment
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Reported Invoices',
    'dashboard_credit_invoices_reported',
    'Default columns for credit dashboard reported invoices detail list',
    '{
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "actual_reporting_date"},
            {"table": "Invoice", "field": "reporting_captured_at"},
            {"table": "Invoice", "field": "reporting_comment"}
        ],
        "filters": [],
        "sorting": [{"field": "reporting_captured_at", "direction": "DESC"}],
        "grouping": []
    }'::jsonb,
    true, true, false, 'dashboard_credit_invoices',
    NOW(), NOW(), NULL, NULL
FROM "Account" a
WHERE a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name) DO UPDATE SET
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
