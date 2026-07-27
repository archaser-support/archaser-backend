DO $$
BEGIN
     IF NOT EXISTS (SELECT 1 FROM "CronJob" WHERE name = 'Process Due Notifications') THEN
        INSERT INTO "CronJob" (
            name, 
            cron_expression, 
            active, 
            created_at, 
            modified_at, 
            sort_order,
            timeout_period_seconds,
            alert_enabled,
            success_count_30d, failure_count_30d, timeout_count_30d
        )
        VALUES (
            'Process Due Notifications', 
            '0 9 * * *', 
            true, 
            NOW(), 
            NOW(), 
            1,
            1800,
            true,
            0, 0, 0
        );
    ELSE
        UPDATE "CronJob" 
        SET 
            active = true, 
            modified_at = NOW() 
        WHERE name = 'Process Due Notifications';
    END IF;
END $$;