-- Utilization overshoot ranking drill-down for Portfolio Health Utilization.
-- Run manually / on deploy for existing accounts.

INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Customers Above 100% Utilization',
    'dashboard_credit_customers_utilization_overshoot',
    'Period ranking of customers above 100% utilization (avg/max overshoot %, avg/peak usage, days above limit, longest streak). Null-limit customers excluded.',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "period_avg_overshoot_pts"},
            {"table": "Customer", "field": "period_max_overshoot_pts"},
            {"table": "Customer", "field": "period_max_overshoot_date"},
            {"table": "Customer", "field": "period_avg_usage_pct"},
            {"table": "Customer", "field": "period_peak_usage_pct"},
            {"table": "Customer", "field": "period_peak_usage_date"},
            {"table": "Customer", "field": "period_days_above_limit"},
            {"table": "Customer", "field": "period_longest_above_limit_days"},
            {"table": "Customer", "field": "period_overshoot_days_with_limit"},
            {"table": "Customer", "field": "period_days_available"}
        ],
        "filters": [],
        "sorting": [{"field": "period_avg_overshoot_pts", "direction": "DESC"}],
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
