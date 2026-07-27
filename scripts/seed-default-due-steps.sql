-- ============================================================================
-- Seed Script: Add Default Due Notification Steps (7d, 3d, 0d)
-- Context: Due invoice notifications - adds default steps to Automated containers
-- ============================================================================
--
-- For each SequenceContainer with category='Automated' that does NOT already
-- have due steps, this script adds 3 default due steps: 7 days, 3 days, 0 days
-- before invoice due date.
--
-- Run AFTER 20250204_add_due_notification_support.sql
-- Execute manually (DBeaver) or: psql $DATABASE_URL -f scripts/seed-default-due-steps.sql
--
-- ============================================================================

BEGIN;

DO $$
DECLARE
    rec RECORD;
    max_step_val INT;
BEGIN
    FOR rec IN
        SELECT sc.id AS container_id, sc.account_id
        FROM "SequenceContainer" sc
        WHERE sc.category = 'Automated'
        AND sc.active = true
        AND NOT EXISTS (
            SELECT 1 FROM "ActivitiesSequence" aseq
            WHERE aseq.sequence_container_id = sc.id
            AND aseq.step_type = 'due'
        )
    LOOP
        -- 1. Renumber existing overdue steps: step = step + 3 (make room for due steps 1,2,3)
        UPDATE "ActivitiesSequence"
        SET step = step + 3,
            modified_at = NOW()
        WHERE sequence_container_id = rec.container_id
        AND (step_type = 'overdue' OR step_type IS NULL);

        -- 2. Insert due steps 1, 2, 3 (7d, 3d, 0d before due)
        INSERT INTO "ActivitiesSequence" (
            account_id,
            sequence_container_id,
            category,
            step,
            step_type,
            days_before_due,
            activity_type,
            time_of_day,
            active,
            last_category_step,
            send_to_standard_contacts,
            send_to_escalated_contacts,
            created_at,
            modified_at
        ) VALUES
            (rec.account_id, rec.container_id, 'Automated', 1, 'due', 7, 'Email', '09:00', true, false, true, false, NOW(), NOW()),
            (rec.account_id, rec.container_id, 'Automated', 2, 'due', 3, 'Email', '09:00', true, false, true, false, NOW(), NOW()),
            (rec.account_id, rec.container_id, 'Automated', 3, 'due', 0, 'Email', '09:00', true, false, true, false, NOW(), NOW());

        RAISE NOTICE 'Added default due steps for container % (account %)', rec.container_id, rec.account_id;
    END LOOP;
END $$;

COMMIT;
