-- Add cron jobs for currency-rate fetch and base-currency gap computation

BEGIN;

INSERT INTO "CronJob" (
  "name",
  "active",
  "cron_expression",
  "next_run_at",
  "sort_order",
  "timeout_period_seconds",
  "alert_enabled"
)
SELECT
  'Fetch Currency Rates',
  true,
  '0 5 * * *',
  NOW(),
  210,
  600,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM "CronJob"
  WHERE "name" = 'Fetch Currency Rates'
);

INSERT INTO "CronJob" (
  "name",
  "active",
  "cron_expression",
  "next_run_at",
  "sort_order",
  "timeout_period_seconds",
  "alert_enabled"
)
SELECT
  'Compute Gap In Base Currency',
  true,
  '15 5 * * *',
  NOW(),
  211,
  1200,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM "CronJob"
  WHERE "name" = 'Compute Gap In Base Currency'
);

UPDATE "CronJob"
SET "active" = true
WHERE "name" IN ('Fetch Currency Rates', 'Compute Gap In Base Currency');

COMMIT;
