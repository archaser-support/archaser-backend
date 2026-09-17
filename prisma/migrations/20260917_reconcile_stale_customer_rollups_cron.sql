-- Periodic safety net: recalculate customers whose denormalized due/overdue
-- rollups disagree with live Due/Overdue invoice counts.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "CronJob" WHERE name = 'Reconcile Stale Customer Rollups') THEN
        INSERT INTO "CronJob" (
            name,
            cron_expression,
            active,
            created_at,
            modified_at,
            sort_order,
            timeout_period_seconds,
            alert_enabled,
            success_count_30d,
            failure_count_30d,
            timeout_count_30d
        )
        VALUES (
            'Reconcile Stale Customer Rollups',
            '15 4 * * *',
            true,
            NOW(),
            NOW(),
            24,
            1800,
            true,
            0,
            0,
            0
        );
    ELSE
        UPDATE "CronJob"
        SET active = true,
            cron_expression = '15 4 * * *',
            timeout_period_seconds = 1800,
            alert_enabled = true,
            modified_at = NOW()
        WHERE name = 'Reconcile Stale Customer Rollups';
    END IF;
END $$;

COMMIT;
