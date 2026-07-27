-- ============================================================================
-- UPDATE only: refresh credit dashboard system report columns
-- Use when the original create-dashboard-credit-*-reports.sql was already applied.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- dashboard_credit_customers
-- ---------------------------------------------------------------------------

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_customers_overdue'
  AND is_system = true;

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_customers_capacity'
  AND is_system = true;

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_customers_policy_risk'
  AND is_system = true;

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_customers_limit_warning'
  AND is_system = true;

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_customers_zero_limit_warning'
  AND is_system = true;

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_customers_no_policy_exposure'
  AND is_system = true;

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_customers_top_up'
  AND is_system = true;

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_customers_top_up_expiring'
  AND is_system = true;

-- ---------------------------------------------------------------------------
-- dashboard_credit_invoices
-- ---------------------------------------------------------------------------

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_invoices_terms'
  AND is_system = true;

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_invoices_reporting'
  AND is_system = true;

UPDATE "Report"
SET
    report_config = '{
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
    modified_at = NOW(),
    modified_by = NULL
WHERE unique_name = 'dashboard_credit_invoices_reported'
  AND is_system = true;

COMMIT;

-- Optional verify:
-- SELECT unique_name, report_config->'fields' AS fields, report_config->'sorting' AS sorting
-- FROM "Report"
-- WHERE unique_name LIKE 'dashboard_credit_%'
--   AND is_system = true
-- ORDER BY unique_name;
