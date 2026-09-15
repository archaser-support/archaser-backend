-- Breach episode history / streak cohort drill-down.
-- Run manually / on deploy for existing accounts.

INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Breach Episodes Customers',
    'dashboard_credit_customers_breach_episodes',
    'Customers with at least one terms-breach episode in the period, including streak and episode history',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "period_breach_status"},
            {"table": "Customer", "field": "period_breach_streak_days"},
            {"table": "Customer", "field": "period_breach_episode_count"},
            {"table": "Customer", "field": "period_breach_episodes_summary"},
            {"table": "Customer", "field": "period_breach_last_episode_start"},
            {"table": "Customer", "field": "period_breach_last_episode_end"},
            {"table": "Customer", "field": "period_breach_last_episode_ongoing"},
            {"table": "Customer", "field": "period_breach_last_episode_days"},
            {"table": "Customer", "field": "period_breach_last_episode_peak"},
            {"table": "Customer", "field": "period_longest_breach_streak_days"}
        ],
        "filters": [],
        "sorting": [{"field": "period_breach_episode_count", "direction": "DESC"}],
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
