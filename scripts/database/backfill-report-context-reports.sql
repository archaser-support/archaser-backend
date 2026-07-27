-- Backfill main Reports menu location for saved reports that still have NULL context.
-- Report builder Location "reports" maps to the /app/reports list for account users.
--
-- Run with:
--   psql $DATABASE_URL -f scripts/database/backfill-report-context-reports.sql

BEGIN;

UPDATE "Report"
SET context = 'reports',
    modified_at = NOW()
WHERE context IS NULL;

COMMIT;

-- Verify:
-- SELECT COUNT(*) FROM "Report" WHERE context IS NULL;
