-- Utilization bin (as-of CPT) detail list for portfolio-health histogram click-through.
-- Run manually / on deploy for existing accounts. New accounts copy from template account when applicable.

INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Utilization Band',
    'dashboard_credit_customers_utilization_bin',
    'As-of utilization band customers from portfolio health distribution',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "as_of_utilization_pct"},
            {"table": "Customer", "field": "as_of_usage_amount"}
        ],
        "filters": [],
        "sorting": [{"field": "as_of_utilization_pct", "direction": "DESC"}],
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
