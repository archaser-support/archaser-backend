-- ============================================================================
-- Ensure Open AR (open_receivable_amount) is present on credit-dashboard
-- customer system reports, and context is dashboard_credit_customers.
--
-- Safe to re-run: only appends the field when missing; does not wipe other columns.
--
--   psql "$DATABASE_URL" -f scripts/database/ensure-open-ar-on-credit-dashboard-reports.sql
-- ============================================================================

BEGIN;

-- Repair context if a blanket NULL→reports backfill moved these off the dashboard.
UPDATE "Report"
SET
    context = 'dashboard_credit_customers',
    modified_at = NOW()
WHERE is_system = true
  AND unique_name LIKE 'dashboard_credit_customers_%'
  AND (context IS DISTINCT FROM 'dashboard_credit_customers');

-- Append Open AR when the fields array does not already reference it.
UPDATE "Report"
SET
    report_config = jsonb_set(
        report_config,
        '{fields}',
        COALESCE(report_config->'fields', '[]'::jsonb)
            || '[{"table":"Customer","field":"open_receivable_amount"}]'::jsonb
    ),
    modified_at = NOW()
WHERE is_system = true
  AND unique_name LIKE 'dashboard_credit_customers_%'
  AND unique_name <> 'dashboard_credit_customers_utilization_bin'
  AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(report_config->'fields', '[]'::jsonb)) AS f
        WHERE f->>'table' = 'Customer'
          AND f->>'field' = 'open_receivable_amount'
    );

COMMIT;

-- Verify:
-- SELECT unique_name, context,
--        report_config->'fields' AS fields
-- FROM "Report"
-- WHERE is_system AND unique_name LIKE 'dashboard_credit_customers_%'
-- ORDER BY unique_name;
