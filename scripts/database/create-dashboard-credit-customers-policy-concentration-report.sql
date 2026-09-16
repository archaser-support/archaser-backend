-- Policy concentration ranking (Bucket 1 KPI #9) for Portfolio Health Utilization.
-- Run manually / on deploy for existing accounts.

INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Policy Concentration',
    'dashboard_credit_customers_policy_concentration',
    'Latest-snapshot policy open-AR concentration ranking (customer share, top-1/top-3). Single-customer policies may show 100% context but are excluded from concentration alerting.',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "period_policy_ar_share_pct"},
            {"table": "Customer", "field": "period_policy_open_ar"},
            {"table": "Customer", "field": "period_policy_top1_share_pct"},
            {"table": "Customer", "field": "period_policy_top3_share_pct"},
            {"table": "Customer", "field": "period_concentration_alert"},
            {"table": "Customer", "field": "period_concentration_as_of_date"}
        ],
        "filters": [],
        "sorting": [{"field": "period_policy_ar_share_pct", "direction": "DESC"}],
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
