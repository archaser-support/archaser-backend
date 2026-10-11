-- ============================================================================
-- DBeaver: Revert Limits VS AR / Risk exposures / date compare /
-- Monthly Report (local) back to Reports page (context = reports)
-- ============================================================================
-- Undoes dbeaver-move-reports-to-customer-invoices.sql
-- No top-level BEGIN/COMMIT (CI / prisma db execute already opens a transaction).
-- ============================================================================

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
);

SELECT unique_name, context, bool_and(is_system) AS all_system, COUNT(*) AS accounts
FROM "Report"
WHERE unique_name IN (
    'limits_vs_ar',
    'risk_exposure',
    'date_compare',
    'monthly_report_local'
)
GROUP BY unique_name, context
ORDER BY unique_name, context;
