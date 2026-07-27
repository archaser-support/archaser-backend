-- Seed Sync Billing Connectors cron job (every 15 minutes).
-- Run with: psql $DATABASE_URL -f scripts/database/add-billing-connector-sync-cron-job.sql

BEGIN;

INSERT INTO "CronJob" (
    name,
    description,
    cron_expression,
    is_active,
    timeout_period_seconds,
    created_at,
    modified_at
)
SELECT
    'Sync Billing Connectors',
    'Pulls incremental or backfill data from configured ERP billing connectors',
    '*/15 * * * *',
    false,
    900,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "CronJob" WHERE name = 'Sync Billing Connectors'
);

COMMIT;
