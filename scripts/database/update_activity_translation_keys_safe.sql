-- Migration: Update Activity Translation Keys (Safe Version)
-- Date: 2025-01-27
-- Description: Updates activity titles to use new translation key locations
--              Moves keys from activity.log_activity.* to activity.*
--              Includes backup and rollback capabilities

-- Create backup table before making changes
CREATE TABLE IF NOT EXISTS "Activity_backup_translation_keys" AS 
SELECT id, title, created_at, modified_at 
FROM "Activity" 
WHERE title IS NOT NULL 
  AND (
    title LIKE '%{{activity.log_activity.automated_step_%' OR
    title LIKE '%{{activity.log_activity.promise_to_pay_%' OR
    title LIKE '%{{activity.log_activity.channel_fallback_%' OR
    title LIKE '%{{activity.log_activity.category_change%'
  );

-- Show current state before changes
SELECT 
    'BEFORE UPDATE' as status,
    COUNT(*) as total_activities_with_old_keys,
    COUNT(CASE WHEN title LIKE '%{{activity.log_activity.automated_step_%' THEN 1 END) as automated_step_old,
    COUNT(CASE WHEN title LIKE '%{{activity.log_activity.promise_to_pay_%' THEN 1 END) as promise_to_pay_old,
    COUNT(CASE WHEN title LIKE '%{{activity.log_activity.channel_fallback_%' THEN 1 END) as channel_fallback_old,
    COUNT(CASE WHEN title LIKE '%{{activity.log_activity.category_change%' THEN 1 END) as category_change_old
FROM "Activity" 
WHERE title IS NOT NULL;

-- Update automated activity keys
UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.automated_step_sent}}', '{{activity.automated_step_sent}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.automated_step_sent}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.automated_step_failed}}', '{{activity.automated_step_failed}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.automated_step_failed}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.automated_step_scheduled}}', '{{activity.automated_step_scheduled}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.automated_step_scheduled}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.automated_step_canceled}}', '{{activity.automated_step_canceled}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.automated_step_canceled}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.automated_step_paused}}', '{{activity.automated_step_paused}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.automated_step_paused}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.automated_step_bounced}}', '{{activity.automated_step_bounced}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.automated_step_bounced}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.automated_step_partially_sent}}', '{{activity.automated_step_partially_sent}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.automated_step_partially_sent}}%';

-- Update promise to pay keys
UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.promise_to_pay_sent}}', '{{activity.promise_to_pay_sent}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.promise_to_pay_sent}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.promise_to_pay_scheduled}}', '{{activity.promise_to_pay_scheduled}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.promise_to_pay_scheduled}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.promise_to_pay_canceled}}', '{{activity.promise_to_pay_canceled}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.promise_to_pay_canceled}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.promise_to_pay_paused}}', '{{activity.promise_to_pay_paused}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.promise_to_pay_paused}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.promise_to_pay_bounced}}', '{{activity.promise_to_pay_bounced}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.promise_to_pay_bounced}}%';

-- Update channel fallback keys
UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.channel_fallback_sms_to_email}}', '{{activity.channel_fallback_sms_to_email}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.channel_fallback_sms_to_email}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.channel_fallback_email_to_sms}}', '{{activity.channel_fallback_email_to_sms}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.channel_fallback_email_to_sms}}%';

-- Update category change keys
UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.category_change_title}}', '{{activity.category_change_title}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.category_change_title}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.category_change_to}}', '{{activity.category_change_to}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.category_change_to}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.manual_category_change_title}}', '{{activity.manual_category_change_title}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.manual_category_change_title}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.category_change_old_category}}', '{{activity.category_change_old_category}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.category_change_old_category}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.category_change_new_category}}', '{{activity.category_change_new_category}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.category_change_new_category}}%';

UPDATE "Activity" 
SET title = REPLACE(title, '{{activity.log_activity.category_change}}', '{{activity.category_change}}'),
    modified_at = NOW()
WHERE title LIKE '%{{activity.log_activity.category_change}}%';

-- Show state after changes
SELECT 
    'AFTER UPDATE' as status,
    COUNT(*) as total_activities_with_new_keys,
    COUNT(CASE WHEN title LIKE '%{{activity.automated_step_%' THEN 1 END) as automated_step_new,
    COUNT(CASE WHEN title LIKE '%{{activity.promise_to_pay_%' THEN 1 END) as promise_to_pay_new,
    COUNT(CASE WHEN title LIKE '%{{activity.channel_fallback_%' THEN 1 END) as channel_fallback_new,
    COUNT(CASE WHEN title LIKE '%{{activity.category_change%' THEN 1 END) as category_change_new
FROM "Activity" 
WHERE title IS NOT NULL;

-- Show any remaining old keys (should be 0)
SELECT 
    'REMAINING OLD KEYS' as status,
    COUNT(*) as remaining_old_keys
FROM "Activity" 
WHERE title IS NOT NULL 
  AND (
    title LIKE '%{{activity.log_activity.automated_step_%' OR
    title LIKE '%{{activity.log_activity.promise_to_pay_%' OR
    title LIKE '%{{activity.log_activity.channel_fallback_%' OR
    title LIKE '%{{activity.log_activity.category_change%'
  );

-- ROLLBACK SCRIPT (uncomment to rollback changes)
/*
UPDATE "Activity" a
SET title = backup.title,
    modified_at = NOW()
FROM "Activity_backup_translation_keys" backup
WHERE a.id = backup.id;
*/
