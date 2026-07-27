-- ============================================================================
-- System Reports for Credit Dashboard Customer Detail Lists
-- Context: dashboard_credit_customers
-- ============================================================================
--
-- Creates system reports for ALL accounts.
-- Credit report page selects by unique_name; locked KPI filters come from
-- the credit dashboard filter contract (additionalFilters + server expanders).
--
-- Columns match the legacy EndlessScroll lists per type.
--
-- Reports:
-- 1. overdue (DEFAULT)
-- 2. capacity
-- 3. policy_risk
-- 4. limit_warning
-- 5. zero_limit_warning
-- 6. no_policy_exposure
-- 7. top_up
-- 8. top_up_expiring
--
-- IMPORTANT:
-- 1. Execute this script on the database manually
-- 2. Uses ON CONFLICT (account_id, unique_name) to upsert
-- 3. New accounts also receive these via ReportService.copy/sync from account 10013
-- ============================================================================

BEGIN;

-- 1. Overdue Block Customers (DEFAULT for context)
-- Legacy: policy, customer, outstanding, max days overdue, open invoices
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Overdue Customers',
    'dashboard_credit_customers_overdue',
    'Default columns for credit dashboard overdue (overdue_block) detail list',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "open_receivable_amount"},
            {"table": "Customer", "field": "days_overdue"},
            {"table": "Customer", "field": "open_invoice_count"}
        ],
        "filters": [],
        "sorting": [{"field": "InsurancePolicy.policy_number", "direction": "ASC"}],
        "grouping": []
    }'::jsonb,
    true, true, true, 'dashboard_credit_customers',
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

-- 2. Capacity Gap
-- Legacy: policy, customer, approved limit, limit type, total AR, open invoices, uninsured gap
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Capacity Gap',
    'dashboard_credit_customers_capacity',
    'Default columns for credit dashboard capacity gap detail list',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "approved_limit"},
            {"table": "Customer", "field": "limit_type"},
            {"table": "Customer", "field": "open_receivable_amount"},
            {"table": "Customer", "field": "open_invoice_count"},
            {"table": "Customer", "field": "capacity_gap_amount"}
        ],
        "filters": [],
        "sorting": [{"field": "capacity_gap_amount", "direction": "DESC"}],
        "grouping": []
    }'::jsonb,
    true, true, false, 'dashboard_credit_customers',
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

-- 3. Policy Risk Exposure
-- Legacy: policy, customer, open AR, capacity gap, terms breach outstanding, policy risk allocated
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Policy Risk',
    'dashboard_credit_customers_policy_risk',
    'Default columns for credit dashboard policy risk exposure detail list',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "open_receivable_amount"},
            {"table": "Customer", "field": "capacity_gap_amount"},
            {"table": "Customer", "field": "terms_breach_outstanding"},
            {"table": "Customer", "field": "policy_risk_allocated"}
        ],
        "filters": [],
        "sorting": [{"field": "policy_risk_allocated", "direction": "DESC"}],
        "grouping": []
    }'::jsonb,
    true, true, false, 'dashboard_credit_customers',
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

-- 4. Limit Warning
-- Legacy: policy, customer, warning reason, approved limit, limit source, credit score date,
-- limit expiration date, expires in days
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Limit Warning',
    'dashboard_credit_customers_limit_warning',
    'Default columns for credit dashboard limit warning detail list',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "limit_warning_summary"},
            {"table": "Customer", "field": "approved_limit"},
            {"table": "Customer", "field": "limit_type"},
            {"table": "Customer", "field": "credit_score_input_date"},
            {"table": "Customer", "field": "approved_limit_expiration_date"},
            {"table": "Customer", "field": "limit_expires_in_days"}
        ],
        "filters": [],
        "sorting": [{"field": "open_receivable_amount", "direction": "DESC"}],
        "grouping": []
    }'::jsonb,
    true, true, false, 'dashboard_credit_customers',
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

-- 5. Zero Limit Warning
-- Legacy: policy, customer, zero limit drop date, total AR, open invoices
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Zero Limit Warning',
    'dashboard_credit_customers_zero_limit_warning',
    'Default columns for credit dashboard zero limit warning detail list',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "zero_limit_date"},
            {"table": "Customer", "field": "open_receivable_amount"},
            {"table": "Customer", "field": "open_invoice_count"}
        ],
        "filters": [],
        "sorting": [{"field": "open_receivable_amount", "direction": "DESC"}],
        "grouping": []
    }'::jsonb,
    true, true, false, 'dashboard_credit_customers',
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

-- 6. No Policy Exposure
-- Legacy: policy, customer, customer code, total AR, exclusion reason
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard No Policy Exposure',
    'dashboard_credit_customers_no_policy_exposure',
    'Default columns for credit dashboard no-policy exposure detail list',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "customer_number"},
            {"table": "Customer", "field": "open_receivable_amount"},
            {"table": "Customer", "field": "policy_exclusion_reason"}
        ],
        "filters": [],
        "sorting": [{"field": "open_receivable_amount", "direction": "DESC"}],
        "grouping": []
    }'::jsonb,
    true, true, false, 'dashboard_credit_customers',
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

-- 7. Top-Up Cover
-- Legacy: policy, customer, base approved, top-up cover, effective limit, total AR
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Top-Up Cover',
    'dashboard_credit_customers_top_up',
    'Default columns for credit dashboard top-up cover detail list',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "approved_limit"},
            {"table": "Customer", "field": "top_up_total"},
            {"table": "Customer", "field": "effective_approved_limit"},
            {"table": "Customer", "field": "open_receivable_amount"}
        ],
        "filters": [],
        "sorting": [{"field": "top_up_total", "direction": "DESC"}],
        "grouping": []
    }'::jsonb,
    true, true, false, 'dashboard_credit_customers',
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

-- 8. Top-Up Expiring
-- Legacy list is per CustomerTopUp row (type/value/resolved/end/days left).
INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Top-Up Expiring',
    'dashboard_credit_customers_top_up_expiring',
    'Default columns for credit dashboard top-up expiring detail list',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "top_up_type"},
            {"table": "Customer", "field": "top_up_value"},
            {"table": "Customer", "field": "top_up_resolved_amount"},
            {"table": "Customer", "field": "top_up_end_date"},
            {"table": "Customer", "field": "top_up_days_left"}
        ],
        "filters": [],
        "sorting": [{"field": "top_up_days_left", "direction": "ASC"}],
        "grouping": []
    }'::jsonb,
    true, true, false, 'dashboard_credit_customers',
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
