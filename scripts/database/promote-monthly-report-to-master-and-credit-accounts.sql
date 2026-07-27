-- ============================================================================
-- Promote "Monthly Report" to master account 10013 and copy to credit-enabled accounts
-- Source report: id 2671 on account 10117
-- Unique name: monthly_report
-- ============================================================================
--
-- What this script does:
-- 1. Copies report 2671 from account 10117 into master account 10013
-- 2. Forces the master copy to be a system report
-- 3. Sets the master/report copy context to 'reports' by default
-- 4. Copies that system report to existing, non-deleted accounts where
--    has_credit_insurance = true
--
-- Idempotent:
-- - Uses ON CONFLICT (account_id, unique_name) DO UPDATE
--
-- IMPORTANT:
-- - The report currently contains a fixed date filter in report_config
-- - If you want the report to appear on the main Reports menu (/app/reports),
--   set target_context to 'reports' (required for account users; list API filters on this value)
-- - Embedded page views use other contexts (customers, disputes, etc.)
--
-- Run with:
--   psql $DATABASE_URL -f scripts/database/promote-monthly-report-to-master-and-credit-accounts.sql
-- ============================================================================

BEGIN;

WITH params AS (
    SELECT
        2671::int AS source_report_id,
        10117::int AS source_account_id,
        10013::int AS master_account_id,
        'monthly_report'::varchar AS report_unique_name,
        'reports'::varchar AS target_context
),
source AS (
    SELECT
        r.name,
        r.unique_name,
        r.description,
        r.report_config,
        r.is_public,
        r.created_by,
        r.modified_by
    FROM "Report" r
    CROSS JOIN params p
    WHERE r.id = p.source_report_id
      AND r.account_id = p.source_account_id
      AND r.unique_name = p.report_unique_name
)
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
    p.master_account_id AS account_id,
    s.name,
    s.unique_name,
    s.description,
    s.report_config,
    s.is_public,
    TRUE AS is_system,
    FALSE AS is_default,
    p.target_context AS context,
    NOW() AS created_at,
    NOW() AS modified_at,
    s.created_by,
    s.modified_by
FROM source s
CROSS JOIN params p
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
      AND r.unique_name = 'monthly_report'
      AND r.is_system = TRUE
) m
WHERE a.id <> 10013
  AND a.deleted_at IS NULL
  AND COALESCE(a.has_credit_insurance, FALSE) = TRUE
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
-- Verification queries
-- ============================================================================
--
-- Check the master copy on account 10013:
-- SELECT
--     id,
--     account_id,
--     name,
--     unique_name,
--     is_system,
--     is_default,
--     context,
--     modified_at
-- FROM "Report"
-- WHERE account_id = 10013
--   AND unique_name = 'monthly_report';
--
-- Check all copied accounts:
-- SELECT
--     r.account_id,
--     r.id,
--     r.name,
--     r.unique_name,
--     r.is_system,
--     r.context,
--     a.has_credit_insurance
-- FROM "Report" r
-- JOIN "Account" a ON a.id = r.account_id
-- WHERE r.unique_name = 'monthly_report'
-- ORDER BY r.account_id;
--
-- Check credit-enabled accounts missing the report (should return 0 rows):
-- SELECT a.id
-- FROM "Account" a
-- LEFT JOIN "Report" r
--   ON r.account_id = a.id
--  AND r.unique_name = 'monthly_report'
-- WHERE a.id <> 10013
--   AND a.deleted_at IS NULL
--   AND COALESCE(a.has_credit_insurance, FALSE) = TRUE
--   AND r.id IS NULL;
