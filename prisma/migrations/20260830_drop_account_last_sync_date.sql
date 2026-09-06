-- Drop Account.last_sync_date. The account-wide sync freshness marker is now
-- derived from ConnectorSyncState.last_successful_run_at (oldest across the
-- connector's enabled entities), so the stored column has no remaining reader.
--
-- Apply AFTER deploying the code that removes updateAccountLastSyncDate:
--   psql "$DATABASE_URL" -f prisma/migrations/20260830_drop_account_last_sync_date.sql
-- A pre-deploy sync job still running old code would fail one background run;
-- no user-facing request writes this column.

BEGIN;

ALTER TABLE "Account"
  DROP COLUMN IF EXISTS "last_sync_date";

COMMIT;
