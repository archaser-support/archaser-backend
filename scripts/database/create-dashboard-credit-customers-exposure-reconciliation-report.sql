-- Exposure reconciliation failure drill-down for Portfolio Health.
-- Run manually / on deploy for existing accounts.

INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Exposure Reconciliation',
    'dashboard_credit_customers_exposure_reconciliation',
    'Customers with CTP rows where at-risk + compliant do not match total AR, or at-risk exceeds total',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "period_recon_fail_count"},
            {"table": "Customer", "field": "period_recon_max_abs_delta"},
            {"table": "Customer", "field": "period_recon_worst_delta_date"},
            {"table": "Customer", "field": "period_at_risk_exceeds_total_count"},
            {"table": "Customer", "field": "period_at_risk_exceeds_total_max"}
        ],
        "filters": [],
        "sorting": [{"field": "period_recon_max_abs_delta", "direction": "DESC"}],
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
