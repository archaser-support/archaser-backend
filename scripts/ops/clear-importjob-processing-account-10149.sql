-- One-shot ops clear: fail all stuck Processing ImportJob rows for account 10149
-- so worker crons stop treating the account as frozen.
--
-- Confirm no live import worker is still writing for this account before running
-- (check modified_at / process list). Same terminal message as the stale sweeper.
--
-- Usage (psql / preferred SQL client against the target environment):
--   \i scripts/ops/clear-importjob-processing-account-10149.sql

BEGIN;

UPDATE "ImportJob"
SET
  status = 'Failed',
  error_message = 'Import job marked Failed: no progress for 2 hours (stale Processing sweeper)',
  completed_at = NOW(),
  modified_at = NOW()
WHERE account_id = 10149
  AND status = 'Processing';

-- Optional: review affected row count from the UPDATE, then COMMIT.
COMMIT;
