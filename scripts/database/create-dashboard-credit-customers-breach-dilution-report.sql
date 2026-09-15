-- Breach-dilution (rising health + persistent breach + AR growth) cohort drill-down.
-- Run manually / on deploy for existing accounts.

INSERT INTO "Report" (
    account_id, name, unique_name, description, report_config,
    is_public, is_system, is_default, context,
    created_at, modified_at, created_by, modified_by
)
SELECT
    a.id,
    'Credit Dashboard Breach Dilution Customers',
    'dashboard_credit_customers_breach_dilution',
    'Customers where rising health masks persistent terms breach while AR grows (diluted classification)',
    '{
        "tables": ["Customer"],
        "fields": [
            {"table": "Customer", "field": "InsurancePolicy.policy_number"},
            {"table": "Customer", "field": "name"},
            {"table": "Customer", "field": "period_breach_dilution_classification"},
            {"table": "Customer", "field": "period_breach_dilution_ar_growth_pct"},
            {"table": "Customer", "field": "period_breach_dilution_breach_first"},
            {"table": "Customer", "field": "period_breach_dilution_breach_last"},
            {"table": "Customer", "field": "period_breach_dilution_breach_change_pct"},
            {"table": "Customer", "field": "period_breach_dilution_health_rise_pts"}
        ],
        "filters": [],
        "sorting": [{"field": "period_breach_dilution_ar_growth_pct", "direction": "DESC"}],
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
