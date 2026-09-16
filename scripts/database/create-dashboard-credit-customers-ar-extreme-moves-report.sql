-- Extreme AR day-over-day moves drill-down for Portfolio Health / Customer volatility.
-- Run manually / on deploy for existing accounts.

INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard AR Extreme Moves',
    'dashboard_credit_customers_ar_extreme_moves',
    'Customers with extreme day-over-day AR moves (±10%), volatility σ, stale days, and health slope',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "period_ar_volatility_sigma_pct"},
            {"table": "Customer", "field": "period_ar_extreme_move_count"},
            {"table": "Customer", "field": "period_ar_worst_extreme_pct"},
            {"table": "Customer", "field": "period_ar_worst_extreme_date"},
            {"table": "Customer", "field": "period_stale_day_count"},
            {"table": "Customer", "field": "period_health_slope"},
            {"table": "Customer", "field": "period_health_momentum"}
        ],
        "filters": [],
        "sorting": [{"field": "period_ar_extreme_move_count", "direction": "DESC"}],
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
