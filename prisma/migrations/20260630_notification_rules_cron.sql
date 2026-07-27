BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "CronJob" WHERE name = 'Process Notification Rules') THEN
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
            'Process Notification Rules',
            '30 3 * * *',
            true,
            NOW(),
            NOW(),
            23,
            1800,
            true,
            0,
            0,
            0
        );
    ELSE
        UPDATE "CronJob"
        SET active = true,
            cron_expression = '30 3 * * *',
            timeout_period_seconds = 1800,
            alert_enabled = true,
            modified_at = NOW()
        WHERE name = 'Process Notification Rules';
    END IF;
END $$;

COMMIT;
