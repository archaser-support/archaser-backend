-- Migration: Update last_call_result values in CustomerCollectionPeriod table
-- This migration converts last_call_result values to translation keys format using double brackets
-- Expected format: {{activities.values.outcomes_XXX}} (translation keys that get converted during fetch)
-- 
-- Translation keys in activities.json:
-- - outcomes_add_new_contact -> {{activities.values.outcomes_add_new_contact}}
-- - outcomes_bad_number -> {{activities.values.outcomes_bad_number}}
-- - outcomes_general -> {{activities.values.outcomes_general}}
-- - outcomes_generic_comment -> {{activities.values.outcomes_generic_comment}}
-- - outcomes_make_payment -> {{activities.values.outcomes_make_payment}}
-- - outcomes_move_to_legal -> {{activities.values.outcomes_move_to_legal}}
-- - outcomes_no_answer -> {{activities.values.outcomes_no_answer}}
-- - outcomes_open_dispute -> {{activities.values.outcomes_open_dispute}}
-- - outcomes_promise_to_pay -> {{activities.values.outcomes_promise_to_pay}}
-- - outcomes_schedule_follow_up -> {{activities.values.outcomes_schedule_follow_up}}
--
-- The database stores {{activities.values.outcomes_XXX}} format, which gets converted during fetch
-- Same pattern as Activity title and content fields use

BEGIN;

-- Create a backup table before migration
CREATE TABLE IF NOT EXISTS "DebtorCollectionPeriod_last_call_result_backup" AS
SELECT 
    id,
    last_call_result,
    last_call,
    modified_at
FROM "CustomerCollectionPeriod"
WHERE last_call_result IS NOT NULL;

-- Update last_call_result values to standardized format
-- Normalize whitespace first (keep case for TRANSLATE pattern extraction)
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = TRIM(last_call_result),
    modified_at = NOW()
WHERE last_call_result IS NOT NULL
  AND TRIM(last_call_result) != '';

-- Step 0: Convert existing TRANSLATE: keys and activity.outcomes.XXX patterns to double bracket format
-- Convert TRANSLATE:activity.outcomes.XXX -> {{activities.values.outcomes_XXX}}
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = CASE
        -- Convert TRANSLATE:activity.outcomes.XXX to {{activities.values.outcomes_XXX}}
        -- Extract value after 'TRANSLATE:activity.outcomes.' and convert to lowercase
        WHEN last_call_result ILIKE 'TRANSLATE:activity.outcomes.%' THEN
            CONCAT('{{activities.values.outcomes_', LOWER(SUBSTRING(last_call_result FROM LENGTH('TRANSLATE:activity.outcomes.') + 1)), '}}')
        -- Convert TRANSLATE:activity.outcome.XXX (without 's') -> convert to double brackets
        WHEN last_call_result ILIKE 'TRANSLATE:activity.outcome.%' THEN
            CONCAT('{{activities.values.outcomes_', LOWER(SUBSTRING(last_call_result FROM LENGTH('TRANSLATE:activity.outcome.') + 1)), '}}')
        -- Convert activity.outcomes.XXX (without TRANSLATE:) -> convert to double brackets
        WHEN last_call_result ILIKE 'activity.outcomes.%' THEN
            CONCAT('{{activities.values.outcomes_', REPLACE(last_call_result, 'activity.outcomes.', ''), '}}')
        -- Convert activity.outcome.XXX (without TRANSLATE: and without 's') -> fix both and convert
        WHEN last_call_result ILIKE 'activity.outcome.%' THEN
            CONCAT('{{activities.values.outcomes_', REPLACE(last_call_result, 'activity.outcome.', ''), '}}')
        -- If already in double bracket format, keep as is
        WHEN last_call_result LIKE '{{activities.values.outcomes_%}}' THEN last_call_result
        -- If already in double bracket format without activities prefix, add it
        WHEN last_call_result LIKE '{{values.outcomes_%}}' THEN
            REPLACE(last_call_result, '{{values.outcomes_', '{{activities.values.outcomes_')
        ELSE last_call_result
    END,
    modified_at = NOW()
WHERE last_call_result IS NOT NULL
  AND (
    last_call_result ILIKE '%activity.outcomes.%'
    OR last_call_result ILIKE '%activity.outcome.%'
    OR last_call_result ILIKE 'TRANSLATE:%'
    OR last_call_result LIKE '{{values.outcomes_%}}'
  );

-- Step 0.5: Convert all remaining values to lowercase for mapping (but skip already converted double bracket format)
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = LOWER(TRIM(last_call_result)),
    modified_at = NOW()
WHERE last_call_result IS NOT NULL
  AND last_call_result NOT LIKE '{{%}}'
  AND last_call_result != LOWER(TRIM(last_call_result));

-- Step 1: Map "Add new contact" variations to translation key
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = '{{activities.values.outcomes_add_new_contact}}',
    modified_at = NOW()
WHERE last_call_result NOT LIKE '{{%}}'
  AND LOWER(last_call_result) IN (
    'add new contact',
    'add_new_contact',
    'add-new-contact',
    'addnewcontact',
    'add contact',
    'add_contact',
    'add-contact',
    'new contact',
    'new_contact',
    'new-contact'
);

-- Step 2: Map "Bad number" variations to translation key
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = '{{activities.values.outcomes_bad_number}}',
    modified_at = NOW()
WHERE last_call_result NOT LIKE '{{%}}'
  AND LOWER(last_call_result) IN (
    'bad number',
    'bad_number',
    'bad-number',
    'badnumber',
    'wrong number',
    'wrong_number',
    'wrong-number',
    'invalid number',
    'invalid_number',
    'invalid-number'
);

-- Step 3: Map "General" variations (including "General Discussion") to translation key
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = '{{activities.values.outcomes_general}}',
    modified_at = NOW()
WHERE last_call_result NOT LIKE '{{%}}'
  AND LOWER(last_call_result) IN (
    'general',
    'general discussion',
    'general_discussion',
    'general-discussion',
    'generalcall',
    'general call',
    'general_call',
    'general-call',
    'generaldiscussion'
);

-- Step 4: Map "Generic comment" / "Add comment" variations to translation key
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = '{{activities.values.outcomes_generic_comment}}',
    modified_at = NOW()
WHERE last_call_result NOT LIKE '{{%}}'
  AND LOWER(last_call_result) IN (
    'generic comment',
    'generic_comment',
    'generic-comment',
    'genericcomment',
    'add comment',
    'add_comment',
    'add-comment',
    'addcomment',
    'comment',
    'note',
    'notes'
);

-- Step 5: Map "Make payment" / "Payment arrangement" variations to translation key
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = '{{activities.values.outcomes_make_payment}}',
    modified_at = NOW()
WHERE last_call_result NOT LIKE '{{%}}'
  AND LOWER(last_call_result) IN (
    'make payment',
    'make_payment',
    'make-payment',
    'makepayment',
    'payment arrangement',
    'payment_arrangement',
    'payment-arrangement',
    'paymentarrangement',
    'payment',
    'payment made',
    'payment_made',
    'payment-made'
);

-- Step 6: Map "Move to legal" variations to translation key
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = '{{activities.values.outcomes_move_to_legal}}',
    modified_at = NOW()
WHERE last_call_result NOT LIKE '{{%}}'
  AND LOWER(last_call_result) IN (
    'move to legal',
    'move_to_legal',
    'move-to-legal',
    'movetolegal',
    'transfer to legal',
    'transfer_to_legal',
    'transfer-to-legal',
    'legal',
    'moved to legal',
    'moved_to_legal',
    'moved-to-legal'
);

-- Step 7: Map "No answer" variations to translation key
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = '{{activities.values.outcomes_no_answer}}',
    modified_at = NOW()
WHERE last_call_result NOT LIKE '{{%}}'
  AND LOWER(last_call_result) IN (
    'no answer',
    'no_answer',
    'no-answer',
    'noanswer',
    'no answer received',
    'no_answer_received',
    'no-answer-received',
    'not answered',
    'not_answered',
    'not-answered',
    'unanswered',
    'did not answer',
    'did_not_answer',
    'did-not-answer'
);

-- Step 8: Map "Open dispute" variations to translation key
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = '{{activities.values.outcomes_open_dispute}}',
    modified_at = NOW()
WHERE last_call_result NOT LIKE '{{%}}'
  AND LOWER(last_call_result) IN (
    'open dispute',
    'open_dispute',
    'open-dispute',
    'opendispute',
    'dispute',
    'dispute opened',
    'dispute_opened',
    'dispute-opened',
    'disputeopen',
    'opened dispute',
    'opened_dispute',
    'opened-dispute'
);

-- Step 9: Map "Promise to pay" variations (including "Promise to Pay") to translation key
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = '{{activities.values.outcomes_promise_to_pay}}',
    modified_at = NOW()
WHERE last_call_result NOT LIKE '{{%}}'
  AND LOWER(last_call_result) IN (
    'promise to pay',
    'promise_to_pay',
    'promise-to-pay',
    'promisetopay',
    'promise',
    'promised to pay',
    'promised_to_pay',
    'promised-to-pay',
    'promised payment',
    'promised_payment',
    'promised-payment',
    'promise payment',
    'promise_payment',
    'promise-payment'
);

-- Step 10: Map "Schedule follow-up call" variations (including "Schedule Follow-up Call") to translation key
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = '{{activities.values.outcomes_schedule_follow_up}}',
    modified_at = NOW()
WHERE last_call_result NOT LIKE '{{%}}'
  AND LOWER(last_call_result) IN (
    'schedule follow-up call',
    'schedule_follow_up_call',
    'schedule-follow-up-call',
    'schedulefollowupcall',
    'schedule follow up call',
    'schedule_follow_up',
    'schedule-follow-up',
    'schedulefollowup',
    'follow up scheduled',
    'follow_up_scheduled',
    'follow-up-scheduled',
    'followup scheduled',
    'follow-up',
    'follow_up',
    'followup',
    'schedule follow-up',
    'schedule_follow_up',
    'schedule-follow-up',
    'schedule followup'
);

-- Step 11: Handle any remaining values that need conversion to translation keys
-- Convert normalized snake_case values to translation keys with double brackets
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = CASE
        WHEN last_call_result = 'add_new_contact' THEN '{{activities.values.outcomes_add_new_contact}}'
        WHEN last_call_result = 'bad_number' THEN '{{activities.values.outcomes_bad_number}}'
        WHEN last_call_result = 'general' THEN '{{activities.values.outcomes_general}}'
        WHEN last_call_result = 'generic_comment' THEN '{{activities.values.outcomes_generic_comment}}'
        WHEN last_call_result = 'make_payment' THEN '{{activities.values.outcomes_make_payment}}'
        WHEN last_call_result = 'move_to_legal' THEN '{{activities.values.outcomes_move_to_legal}}'
        WHEN last_call_result = 'no_answer' THEN '{{activities.values.outcomes_no_answer}}'
        WHEN last_call_result = 'open_dispute' THEN '{{activities.values.outcomes_open_dispute}}'
        WHEN last_call_result = 'promise_to_pay' THEN '{{activities.values.outcomes_promise_to_pay}}'
        WHEN last_call_result = 'schedule_follow_up' THEN '{{activities.values.outcomes_schedule_follow_up}}'
        ELSE last_call_result
    END,
    modified_at = NOW()
WHERE last_call_result IS NOT NULL
  AND last_call_result NOT LIKE '{{%}}'
  AND last_call_result IN (
    'add_new_contact',
    'bad_number',
    'general',
    'generic_comment',
    'make_payment',
    'move_to_legal',
    'no_answer',
    'open_dispute',
    'promise_to_pay',
    'schedule_follow_up'
  );

-- Step 12: Normalize any remaining values to snake_case, then convert to translation keys
-- Replace spaces, dashes, and dots with underscores, then map to translation key with double brackets
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = CONCAT('{{activities.values.outcomes_', REGEXP_REPLACE(
        REGEXP_REPLACE(
            REGEXP_REPLACE(LOWER(TRIM(last_call_result)), '[^a-z0-9]+', '_', 'g'),
            '_+', '_', 'g'
        ),
        '^_|_$', '', 'g'
    ), '}}'),
    modified_at = NOW()
WHERE last_call_result IS NOT NULL
  AND last_call_result NOT LIKE '{{%}}'
  AND (
    last_call_result LIKE '% %'
    OR last_call_result LIKE '%-%'
    OR last_call_result LIKE '%.%'
    OR last_call_result != LOWER(last_call_result)
  );

-- Step 13: Final cleanup - ensure all double bracket keys are properly formatted
-- Remove any double underscores or trailing underscores from translation keys
UPDATE "CustomerCollectionPeriod"
SET 
    last_call_result = CASE
        -- Fix keys with double underscores or trailing underscores
        WHEN last_call_result LIKE '{{activities.values.outcomes_%__%}}' OR 
             last_call_result LIKE '{{activities.values.outcomes_%_}}' THEN
            CONCAT('{{activities.values.outcomes_', TRIM(BOTH '_' FROM REGEXP_REPLACE(
                REPLACE(REPLACE(last_call_result, '{{activities.values.outcomes_', ''), '}}', ''),
                '_+', '_', 'g'
            )), '}}')
        ELSE last_call_result
    END,
    modified_at = NOW()
WHERE last_call_result IS NOT NULL
  AND last_call_result LIKE '{{activities.values.outcomes_%}}'
  AND (
    last_call_result LIKE '%__%'
    OR last_call_result LIKE '%_}}'
  );

-- Verification query: Show the distribution of values after migration
SELECT 
    'Post-Migration Values' as query_type,
    last_call_result,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM "CustomerCollectionPeriod"
WHERE last_call_result IS NOT NULL
GROUP BY last_call_result
ORDER BY count DESC;

-- Verification query: Check for any values that don't match expected translation keys
SELECT 
    'Unexpected Values' as query_type,
    last_call_result,
    COUNT(*) as count
FROM "CustomerCollectionPeriod"
WHERE last_call_result IS NOT NULL
  AND last_call_result NOT LIKE '{{activities.values.outcomes_%}}'
GROUP BY last_call_result
ORDER BY count DESC;

-- Optional: Rollback script (uncomment to restore from backup)
-- UPDATE "CustomerCollectionPeriod" dcp
-- SET 
--     last_call_result = backup.last_call_result,
--     modified_at = backup.modified_at
-- FROM "DebtorCollectionPeriod_last_call_result_backup" backup
-- WHERE dcp.id = backup.id;

COMMIT;

-- After migration, you can drop the backup table if everything looks good:
-- DROP TABLE IF EXISTS "DebtorCollectionPeriod_last_call_result_backup";

