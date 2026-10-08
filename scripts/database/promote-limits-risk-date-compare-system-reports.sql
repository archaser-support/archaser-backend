-- ============================================================================
-- Promote Limits VS AR / Risk exposures / Invoice date & due date are the same
-- to master account 10013 and copy to all active accounts
-- ============================================================================
--
-- Source reports (account 10149):
--   5131  Limits VS AR                          unique_name: limits_vs_ar
--   5132  Risk exposures                        unique_name: risk_exposure
--   5133  Invoice date & due date are the same  unique_name: date_compare
--
-- What this script does:
-- 1. Updates source rows on 10149: is_system, context=reports, refreshed descriptions
-- 2. Upserts each report onto master account 10013 as a system report
-- 3. Copies those master system reports to every other non-deleted account
--
-- Idempotent: ON CONFLICT (account_id, unique_name) DO UPDATE
--
-- Run with:
--   psql $DATABASE_URL -f scripts/database/promote-limits-risk-date-compare-system-reports.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Refresh source reports on account 10149
-- ---------------------------------------------------------------------------
UPDATE "Report"
SET
    is_system = TRUE,
    is_default = FALSE,
    context = 'reports',
    description = 'Customer name, number, approved limit, open receivables (AR), and limit type. No filters (all customers).',
    modified_at = NOW()
WHERE id = 5131
  AND account_id = 10149
  AND unique_name = 'limits_vs_ar';

UPDATE "Report"
SET
    is_system = TRUE,
    is_default = FALSE,
    context = 'reports',
    description = 'Customer name, number, open receivables, at-risk exposure, terms breach outstanding, and capacity gap. Only customers where open receivables is not zero.',
    modified_at = NOW()
WHERE id = 5132
  AND account_id = 10149
  AND unique_name = 'risk_exposure';

UPDATE "Report"
SET
    is_system = TRUE,
    is_default = FALSE,
    context = 'reports',
    description = 'Customer name with invoice date, due date, and amount without VAT. Filters: invoice date is last month, invoice date equals due date (The Same = Yes), and parent customer name is empty.',
    modified_at = NOW()
WHERE id = 5133
  AND account_id = 10149
  AND unique_name = 'date_compare';

-- ---------------------------------------------------------------------------
-- 2) Upsert onto master account 10013
-- ---------------------------------------------------------------------------
INSERT INTO "Report" (
    account_id,
    name,
    unique_name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT
    10013 AS account_id,
    r.name,
    r.unique_name,
    r.description,
    r.report_config,
    r.is_public,
    TRUE AS is_system,
    FALSE AS is_default,
    'reports' AS context,
    NOW() AS created_at,
    NOW() AS modified_at,
    r.created_by,
    r.modified_by
FROM "Report" r
WHERE r.id IN (5131, 5132, 5133)
  AND r.account_id = 10149
  AND r.unique_name IN ('limits_vs_ar', 'risk_exposure', 'date_compare')
ON CONFLICT (account_id, unique_name)
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = TRUE,
    is_default = FALSE,
    context = 'reports',
    modified_at = NOW(),
    modified_by = EXCLUDED.modified_by;

-- ---------------------------------------------------------------------------
-- 3) Copy master system reports to all other active accounts
-- ---------------------------------------------------------------------------
INSERT INTO "Report" (
    account_id,
    name,
    unique_name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT
    a.id AS account_id,
    m.name,
    m.unique_name,
    m.description,
    m.report_config,
    m.is_public,
    TRUE AS is_system,
    FALSE AS is_default,
    m.context,
    NOW() AS created_at,
    NOW() AS modified_at,
    m.created_by,
    m.modified_by
FROM "Account" a
CROSS JOIN (
    SELECT
        r.name,
        r.unique_name,
        r.description,
        r.report_config,
        r.is_public,
        r.context,
        r.created_by,
        r.modified_by
    FROM "Report" r
    WHERE r.account_id = 10013
      AND r.is_system = TRUE
      AND r.context = 'reports'
      AND r.unique_name IN ('limits_vs_ar', 'risk_exposure', 'date_compare')
) m
WHERE a.id <> 10013
  AND a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name)
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = TRUE,
    is_default = FALSE,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = EXCLUDED.modified_by;

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT unique_name, COUNT(*) AS accounts
-- FROM "Report"
-- WHERE unique_name IN ('limits_vs_ar', 'risk_exposure', 'date_compare')
--   AND is_system = TRUE
--   AND context = 'reports'
-- GROUP BY unique_name
-- ORDER BY unique_name;
--
-- SELECT id, account_id, name, unique_name, is_system, context, description
-- FROM "Report"
-- WHERE account_id = 10013
--   AND unique_name IN ('limits_vs_ar', 'risk_exposure', 'date_compare');
