-- Limit-breach forecast / projected warnings (Bucket 1 KPI #10).
-- Run manually / on deploy for existing accounts.

INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Limit Breach Forecast',
    'dashboard_credit_customers_limit_breach_forecast',
    'Projected utilization crossings of 150%/200% from trailing 30-day usage trend (R² floor applied). Clearly labeled as projected — distinct from actual near-limit / score warnings.',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "period_forecast_status"},
            {"table": "Customer", "field": "period_projected_threshold_pct"},
            {"table": "Customer", "field": "period_projected_date"},
            {"table": "Customer", "field": "period_projected_days_to_threshold"},
            {"table": "Customer", "field": "period_projected_current_usage_pct"},
            {"table": "Customer", "field": "period_projected_r_squared"},
            {"table": "Customer", "field": "limit_warning_summary"}
        ],
        "filters": [],
        "sorting": [{"field": "period_projected_days_to_threshold", "direction": "ASC"}],
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
