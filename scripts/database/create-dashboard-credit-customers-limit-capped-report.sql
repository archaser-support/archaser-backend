-- Limit-capped (compliant-exposure ceiling) cohort drill-down.
-- Run manually / on deploy for existing accounts.

INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Limit-Capped Customers',
    'dashboard_credit_customers_limit_capped',
    'Customers where compliant exposure is flat while total AR grows (limit-capped flag). Includes AR vs compliant growth % and CVs.',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "period_limit_capped"},
            {"table": "Customer", "field": "period_limit_capped_ar_growth_pct"},
            {"table": "Customer", "field": "period_limit_capped_compliant_growth_pct"},
            {"table": "Customer", "field": "period_limit_capped_compliant_cv"},
            {"table": "Customer", "field": "period_limit_capped_ar_cv"},
            {"table": "Customer", "field": "period_avg_overshoot_pts"},
            {"table": "Customer", "field": "period_days_available"}
        ],
        "filters": [],
        "sorting": [{"field": "period_limit_capped_ar_growth_pct", "direction": "DESC"}],
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
