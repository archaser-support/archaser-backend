-- Negative daily-cost period drill-down for Portfolio Health Costs tab.
-- Run manually / on deploy for existing accounts.

INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Negative Daily Cost',
    'dashboard_credit_customers_negative_daily_cost',
    'Customers with anomalous negative policy/total daily cost entries above the minimum magnitude',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "period_negative_cost_entry_count"},
            {"table": "Customer", "field": "period_negative_cost_sum"},
            {"table": "Customer", "field": "period_worst_negative_cost_amount"},
            {"table": "Customer", "field": "approved_limit_currency"},
            {"table": "Customer", "field": "period_worst_negative_cost_date"}
        ],
        "filters": [],
        "sorting": [{"field": "period_negative_cost_sum", "direction": "ASC"}],
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
