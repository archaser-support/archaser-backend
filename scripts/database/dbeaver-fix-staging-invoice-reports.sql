-- ============================================================================
-- Staging hotfix helpers for Customer Invoices / report contexts
-- No top-level BEGIN/COMMIT (CI-safe).
-- ============================================================================

-- 1) Ensure the four Reports-page system reports are NOT on invoices tab
UPDATE "Report"
SET
    context = 'reports',
    is_system = TRUE,
    is_default = FALSE,
    modified_at = NOW()
WHERE unique_name IN (
    'limits_vs_ar',
    'risk_exposure',
    'date_compare',
    'monthly_report_local'
)
AND context <> 'reports';

-- 2) Ensure Policy Insights unpaid is the only CI default in invoices context
UPDATE "Report"
SET is_default = false,
    modified_at = NOW()
WHERE context = 'customer_unpaid_invoices'
  AND unique_name IN (
      'all_invoices_credit_insurance_policy_insights',
      'due_invoices_credit_insurance_policy_insights',
      'overdue_invoices_credit_insurance_policy_insights'
  )
  AND is_default = true;

UPDATE "Report"
SET is_default = true,
    modified_at = NOW()
WHERE context = 'customer_unpaid_invoices'
  AND unique_name = 'all_unpaid_invoices_credit_insurance_policy_insights';

-- 3) Verification
SELECT unique_name, context, is_system, is_default, COUNT(*) AS accounts
FROM "Report"
WHERE unique_name IN (
    'limits_vs_ar',
    'risk_exposure',
    'date_compare',
    'monthly_report_local',
    'all_unpaid_invoices_credit_insurance_policy_insights',
    'all_invoices_credit_insurance_policy_insights',
    'due_invoices_credit_insurance_policy_insights',
    'overdue_invoices_credit_insurance_policy_insights',
    'all_unpaid_invoices',
    'all_invoices'
)
GROUP BY unique_name, context, is_system, is_default
ORDER BY unique_name, context;
