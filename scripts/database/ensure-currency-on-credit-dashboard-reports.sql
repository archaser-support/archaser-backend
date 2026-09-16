-- ============================================================================
-- Ensure currency companion fields on credit-dashboard money columns.
-- Invoice reports: customer_currency (with customer_outstanding_debt)
-- Customer reports: approved_limit_currency (with AR / limit / gap / cost amounts)
--
-- Run: psql "$DATABASE_URL" -f scripts/database/ensure-currency-on-credit-dashboard-reports.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- dashboard_credit_invoices — customer_currency
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
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "customer_currency"}
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
            {"table": "Invoice", "field": "customer_currency"},
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
            {"table": "Invoice", "field": "customer_currency"},
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

-- ---------------------------------------------------------------------------
-- dashboard_credit_customers — append approved_limit_currency when missing
-- ---------------------------------------------------------------------------

UPDATE "Report" r
SET
    report_config = jsonb_set(
        r.report_config,
        '{fields}',
        (
            SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
            FROM (
                SELECT elem, ord
                FROM jsonb_array_elements(r.report_config->'fields')
                    WITH ORDINALITY AS t(elem, ord)
                UNION ALL
                SELECT
                    '{"table":"Customer","field":"approved_limit_currency"}'::jsonb,
                    1000000
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(r.report_config->'fields') AS f
                    WHERE f->>'table' = 'Customer'
                      AND f->>'field' = 'approved_limit_currency'
                )
            ) AS combined(elem, ord)
        )
    ),
    modified_at = NOW(),
    modified_by = NULL
WHERE r.is_system = true
  AND r.unique_name LIKE 'dashboard_credit_customers_%'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(r.report_config->'fields') AS f
      WHERE f->>'table' = 'Customer'
        AND f->>'field' IN (
            'open_receivable_amount',
            'approved_limit',
            'effective_approved_limit',
            'capacity_gap_amount',
            'terms_breach_outstanding',
            'policy_risk_allocated',
            'at_risk_exposure',
            'top_up_resolved_amount',
            'top_up_value',
            'as_of_usage_amount',
            'period_worst_negative_cost_amount',
            'period_negative_cost_sum'
        )
  );

COMMIT;

-- Optional verify:
-- SELECT unique_name,
--        report_config->'fields' AS fields
-- FROM "Report"
-- WHERE is_system = true
--   AND (
--     unique_name LIKE 'dashboard_credit_invoices_%'
--     OR unique_name LIKE 'dashboard_credit_customers_%'
--   )
-- ORDER BY unique_name;
