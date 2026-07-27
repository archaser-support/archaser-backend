-- ============================================================================
-- COMPREHENSIVE CONSOLIDATED MIGRATION: Update Activity Translation Keys
-- Date: 2025-01-27
-- Description: Complete migration script with ALL updates:
--              - Dispute keys → disputes.fields.* (NOT activities.fields.*)
--              - Activity keys → activities.fields.*
--              - Category changes (CORRECTED mapping)
--              - Follow-up keys (all variations)
--              - Promise to pay keys (all variations)
--              - Log activity content keys → activities.fields.log_activity_*
--              - Content field updates (handles multiple keys per field)
--              - All old pattern variations
--
-- IMPORTANT: 
-- 1. Dispute-related activities use {{disputes.fields.*}} namespace
-- 2. Activity-related activities use {{activities.fields.*}} namespace
-- 3. Content fields can have multiple different translation keys
-- 4. Category changes: category_change vs category_change_to (CORRECTED)
--
-- BACKUP FIRST! Run this before executing:
-- CREATE TABLE "Activity_backup_before_translation_migration" AS SELECT * FROM "Activity";
-- ============================================================================

-- ============================================================================
-- PART 0: ANALYSIS QUERIES (Run FIRST to see current state)
-- ============================================================================

-- DIAGNOSTIC: Find formatted category change titles that need migration
-- This helps identify titles like "Category changed from X to Y by Z"
SELECT 
    id,
    title,
    CASE 
        WHEN title_params IS NULL THEN 'MISSING title_params'
        WHEN title_params::text LIKE '%oldCategory%' AND title_params::text LIKE '%newCategory%' THEN 'Has params'
        ELSE 'PARAMS INCOMPLETE'
    END as params_status,
    title_params
FROM "Activity"
WHERE title NOT LIKE '%{{%'
  AND (
    (title ILIKE '%category changed from%' AND title ILIKE '%to%' AND title ILIKE '%by%')
    OR (title LIKE '%customer.category_values.%' AND title LIKE '%from%' AND title LIKE '%to%' AND title LIKE '%by%')
  )
ORDER BY created_at DESC
LIMIT 20;

-- Extract all unique translation keys from title field
WITH title_keys AS (
    SELECT 
        id,
        title,
        REGEXP_MATCHES(title, '\{\{([a-zA-Z0-9_.]+)\}\}', 'g') AS key_match
    FROM "Activity"
    WHERE title IS NOT NULL 
        AND title LIKE '%{{%'
),
extracted_title_keys AS (
    SELECT 
        id,
        title,
        (key_match[1])::text AS translation_key
    FROM title_keys
)
SELECT 
    'TITLE KEYS' as field_type,
    translation_key,
    COUNT(*) as occurrences
FROM extracted_title_keys
GROUP BY translation_key
ORDER BY occurrences DESC;

-- Extract all unique translation keys from content field
WITH content_keys AS (
    SELECT 
        id,
        content,
        REGEXP_MATCHES(content, '\{\{([a-zA-Z0-9_.]+)\}\}', 'g') AS key_match
    FROM "Activity"
    WHERE content IS NOT NULL 
        AND content LIKE '%{{%'
),
extracted_content_keys AS (
    SELECT 
        id,
        content,
        (key_match[1])::text AS translation_key
    FROM content_keys
)
SELECT 
    'CONTENT KEYS' as field_type,
    translation_key,
    COUNT(*) as occurrences
FROM extracted_content_keys
GROUP BY translation_key
ORDER BY occurrences DESC;

-- Summary by pattern type
SELECT 
    CASE 
        WHEN title LIKE '%{{activities.fields.%' THEN 'activities.fields.* (CORRECT)'
        WHEN title LIKE '%{{activities.values.%' THEN 'activities.values.* (CORRECT)'
        WHEN title LIKE '%{{activities.sections.%' THEN 'activities.sections.* (CORRECT)'
        WHEN title LIKE '%{{disputes.fields.%' THEN 'disputes.fields.* (CORRECT)'
        WHEN title LIKE '%{{disputes.values.%' THEN 'disputes.values.* (CORRECT)'
        WHEN title LIKE '%{{activity.%' THEN 'activity.* (NEEDS MIGRATION)'
        WHEN title LIKE '%{{dispute.%' THEN 'dispute.* (NEEDS MIGRATION)'
        WHEN title LIKE '%{{fields.%' THEN 'fields.* (NEEDS activities prefix)'
        WHEN title LIKE '%{{values.%' THEN 'values.* (NEEDS activities prefix)'
        WHEN title LIKE '%{{%' THEN 'Other translation key'
        ELSE 'No translation key'
    END as pattern_type,
    COUNT(*) as count
FROM "Activity"
WHERE title IS NOT NULL
GROUP BY pattern_type
ORDER BY count DESC;

-- ============================================================================
-- PART 1: BACKUP
-- ============================================================================

-- Uncomment to create backup:
-- CREATE TABLE "Activity_backup_before_translation_migration" AS SELECT * FROM "Activity";

-- ============================================================================
-- PART 2: BEGIN TRANSACTION
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 3: UPDATE DISPUTE-RELATED TITLE KEYS
-- IMPORTANT: Disputes use {{disputes.fields.*}} NOT {{activities.fields.*}}
-- ============================================================================

-- Dispute filed titles
UPDATE "Activity"
SET title = '{{disputes.fields.filed_title}}'
WHERE title = '{{activity.log_activity.dispute_filed_title}}'
   OR title = '{{activity.dispute_filed_title}}'
   OR title = '{{activities.fields.dispute_filed_title}}';  -- Fix if already migrated wrong

UPDATE "Activity"
SET title = '{{disputes.fields.filed_portal_title}}'
WHERE title = '{{activity.log_activity.dispute_filed_portal_title}}'
   OR title = '{{activity.dispute_filed_portal_title}}'
   OR title = '{{activities.fields.dispute_filed_portal_title}}';  -- Fix if already migrated wrong

-- Dispute opened
UPDATE "Activity"
SET title = '{{disputes.fields.opened}}'
WHERE title = '{{activity.log_activity.dispute.opened}}'
   OR title = '{{activity.log_activity.dispute_opened}}'
   OR title = '{{dispute.resolution.opened}}'
   OR title = '{{dispute.opened}}'
   OR title = '{{activity.dispute_opened}}'
   OR title = '{{activities.fields.dispute_opened}}';  -- Fix if already migrated wrong

-- Dispute resolved
UPDATE "Activity"
SET title = '{{disputes.fields.resolved}}'
WHERE title = '{{activity.log_activity.dispute.resolved}}'
   OR title = '{{activity.log_activity.dispute_resolved}}'
   OR title = '{{dispute.resolution.resolved}}'
   OR title = '{{activity.activity.dispute.resolved}}'
   OR title = '{{dispute.resolved}}'
   OR title = '{{activity.dispute_resolved}}'
   OR title = '{{activities.fields.dispute_resolved}}';  -- Fix if already migrated wrong

-- Dispute status updated
UPDATE "Activity"
SET title = '{{disputes.fields.status_updated}}'
WHERE title = '{{activity.log_activity.dispute.status_updated}}'
   OR title = '{{dispute.resolution.status_updated}}'
   OR title = '{{dispute.status_updated}}'
   OR title = '{{activity.dispute_status_updated}}'
   OR title = '{{activities.fields.dispute_status_updated}}';  -- Fix if already migrated wrong

-- Dispute resolution updated
UPDATE "Activity"
SET title = '{{disputes.fields.resolution_updated}}'
WHERE title = '{{activity.log_activity.dispute.resolution_updated}}'
   OR title = '{{dispute.resolution.activity.resolved_with}}'
   OR title = '{{dispute.resolution.resolution_updated}}'
   OR title = '{{dispute.resolution_updated}}'
   OR title = '{{activity.dispute_resolution_updated}}'
   OR title = '{{activities.fields.dispute_resolution_updated}}';  -- Fix if already migrated wrong

-- Dispute assigned
UPDATE "Activity"
SET title = '{{disputes.fields.assigned}}'
WHERE title = '{{dispute.assign_user.activity_title}}'
   OR title = '{{activity.dispute_assigned}}'
   OR title = '{{activities.fields.dispute_assigned}}';  -- Fix if already migrated wrong

-- Dispute cancelled
UPDATE "Activity"
SET title = '{{disputes.fields.cancelled}}'
WHERE title LIKE '%{{activity.log_activity.dispute_cancelled%'
   OR title LIKE '%{{activity.dispute_cancelled%'
   OR title LIKE '%{{dispute.cancelled%'
   OR title LIKE '%{{activities.fields.dispute_cancelled%';  -- Fix if already migrated wrong

-- ============================================================================
-- PART 4: UPDATE ACTIVITY-RELATED TITLE KEYS
-- Maps to {{activities.fields.*}} namespace with correct key names
-- ============================================================================

-- Automated step titles (key name: activity_automated_step_*)
UPDATE "Activity"
SET title = '{{activities.fields.activity_automated_step_failed}}'
WHERE title = '{{activity.automated_step_failed}}'
   OR title = '{{activity.log_activity.automated_step_failed}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_automated_step_sent}}'
WHERE title = '{{activity.automated_step_sent}}'
   OR title = '{{activity.log_activity.automated_step_sent}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_automated_step_scheduled}}'
WHERE title = '{{activity.automated_step_scheduled}}'
   OR title = '{{activity.log_activity.automated_step_scheduled}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_automated_step_canceled}}'
WHERE title = '{{activity.automated_step_canceled}}'
   OR title = '{{activity.log_activity.automated_step_canceled}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_automated_step_partially_sent}}'
WHERE title = '{{activity.automated_step_partially_sent}}'
   OR title = '{{activity.log_activity.automated_step_partially_sent}}';

-- Promise to Pay titles (COMPREHENSIVE - all variations)
UPDATE "Activity"
SET title = '{{activities.fields.activity_promise_to_pay_sent}}'
WHERE title = '{{activity.promise_to_pay_sent}}'
   OR title = '{{activity.log_activity.promise_to_pay_sent}}'
   OR title = '{{activity.promise_to_pay.activity_sent}}'
   OR title = '{{activity.promise_to_pay.sent}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_promise_to_pay_failed}}'
WHERE title = '{{activity.promise_to_pay_failed}}'
   OR title = '{{activity.log_activity.promise_to_pay_failed}}'
   OR title = '{{activity.promise_to_pay.activity_failed}}'
   OR title = '{{activity.promise_to_pay.failed}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_promise_to_pay_scheduled}}'
WHERE title = '{{activity.promise_to_pay_scheduled}}'
   OR title = '{{activity.log_activity.promise_to_pay_scheduled}}'
   OR title = '{{activity.promise_to_pay.activity_scheduled}}'
   OR title = '{{activity.promise_to_pay.scheduled}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_promise_to_pay_canceled}}'
WHERE title = '{{activity.promise_to_pay_canceled}}'
   OR title = '{{activity.log_activity.promise_to_pay_canceled}}'
   OR title = '{{activity.promise_to_pay.activity_canceled}}'
   OR title = '{{activity.promise_to_pay.canceled}}'
   OR title = '{{activity.log_activity.scheduled_promise_to_pay_reminder_cancelled}}';  -- Old cancelled spelling

UPDATE "Activity"
SET title = '{{activities.fields.activity_promise_to_pay_logged}}'
WHERE title = '{{activity.promise_to_pay_logged}}'
   OR title = '{{activity.log_activity.promise_to_pay_logged}}'
   OR title = '{{activity.promise_to_pay.activity_logged}}'
   OR title = '{{activity.promise_to_pay.logged}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_promise_to_pay_from_portal}}'
WHERE title = '{{activity.promise_to_pay_from_portal}}'
   OR title = '{{activity.log_activity.promise_to_pay_from_portal}}'
   OR title = '{{activity.promise_to_pay.from_portal}}'
   OR title = '{{activity.promise_to_pay.portal}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_promise_to_pay_call}}'
WHERE title = '{{activity.log_activity.promise_to_pay_call}}'
   OR title = '{{activity.promise_to_pay_call}}'
   OR title = '{{activity.promise_to_pay.call}}';

-- Call activity titles (key name: activity_*)
UPDATE "Activity"
SET title = '{{activities.fields.activity_call_activity}}'
WHERE title = '{{activity.log_activity.call_activity}}'
   OR title = '{{activity.call_activity}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_general_call}}'
WHERE title = '{{activity.log_activity.general_call}}'
   OR title = '{{activity.general_call}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_bad_number_call}}'
WHERE title = '{{activity.log_activity.bad_number_call}}'
   OR title = '{{activity.bad_number_call}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_no_answer_call}}'
WHERE title = '{{activity.log_activity.no_answer_call}}'
   OR title = '{{activity.no_answer_call}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_payment_discussion}}'
WHERE title = '{{activity.log_activity.payment_discussion}}'
   OR title = '{{activity.payment_discussion}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_contact_added}}'
WHERE title = '{{activity.log_activity.contact_added}}'
   OR title = '{{activity.contact_added}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_moved_to_legal}}'
WHERE title = '{{activity.log_activity.moved_to_legal}}'
   OR title = '{{activity.moved_to_legal}}';

UPDATE "Activity"
SET title = '{{activities.fields.activity_comment_title_format}}'
WHERE title = '{{activity.log_activity.comment_title_format}}'
   OR title = '{{activity.log_activity.general_comment}}'
   OR title = '{{activity.comment_title_format}}';

-- Follow-up related titles (COMPREHENSIVE)
UPDATE "Activity"
SET title = '{{activities.fields.activity_follow_up_scheduled}}'
WHERE title = '{{activity.log_activity.follow_up_scheduled}}'
   OR title = '{{activity.follow_up_scheduled}}'
   OR title = '{{activity.log_activity.follow_up}}'
   OR title = '{{activity.follow_up}}';

UPDATE "Activity"
SET title = '{{activities.fields.payment_follow_up}}'
WHERE title = '{{activity.payment_follow_up}}'
   OR title = '{{activity.log_activity.payment_follow_up}}';

-- Email/SMS/WhatsApp titles (key name: email_sent, sms_sent, etc. - NO activity_ prefix)
UPDATE "Activity"
SET title = '{{activities.fields.email_sent}}'
WHERE title = '{{activity.log_activity.email_sent}}'
   OR title = '{{activity.email_sent}}';

UPDATE "Activity"
SET title = '{{activities.fields.email_failed}}'
WHERE title = '{{log_activity.email_failed}}'
   OR title = '{{activity.email_failed}}';

UPDATE "Activity"
SET title = '{{activities.fields.email_partially_sent}}'
WHERE title = '{{activity.log_activity.email_partially_sent}}'
   OR title = '{{activity.email_partially_sent}}';

UPDATE "Activity"
SET title = '{{activities.fields.sms_sent}}'
WHERE title = '{{activity.log_activity.sms_sent}}'
   OR title = '{{activity.sms_sent}}';

UPDATE "Activity"
SET title = '{{activities.fields.sms_failed}}'
WHERE title = '{{activity.log_activity.sms_failed}}'
   OR title = '{{activity.sms_failed}}';

UPDATE "Activity"
SET title = '{{activities.fields.sms_partially_sent}}'
WHERE title = '{{activity.log_activity.sms_partially_sent}}'
   OR title = '{{activity.sms_partially_sent}}';

UPDATE "Activity"
SET title = '{{activities.fields.whatsapp_sent}}'
WHERE title = '{{activity.log_activity.whatsapp_sent}}'
   OR title = '{{activity.whatsapp_sent}}';

UPDATE "Activity"
SET title = '{{activities.fields.whatsapp_failed}}'
WHERE title = '{{activity.log_activity.whatsapp_failed}}'
   OR title = '{{activity.whatsapp_failed}}';

UPDATE "Activity"
SET title = '{{activities.fields.whatsapp_partially_sent}}'
WHERE title = '{{activity.log_activity.whatsapp_partially_sent}}'
   OR title = '{{activity.whatsapp_partially_sent}}';

-- Category change titles (CORRECTED MAPPING)
-- category_change: when BOTH oldCategory and newCategory exist

-- First, handle titles that are already formatted strings (not translation keys)
-- These were created before the translation key system
-- Pattern: "Category changed from X to Y by Z" or "קטגוריה שונתה מ-X ל-Y על ידי Z"
-- IMPORTANT: This handles titles that are already fully formatted (not translation keys)
UPDATE "Activity"
SET title = '{{activities.fields.category_change}}'
WHERE title NOT LIKE '%{{%'
  AND title NOT LIKE '%}}%'
  AND (
    -- English pattern: "Category changed from ... to ... by ..."
    (title ILIKE '%category changed from%' AND title ILIKE '% to %' AND title ILIKE '% by %')
    -- Hebrew pattern: "קטגוריה שונתה מ-... ל-... על ידי ..."
    OR (title ILIKE '%קטגוריה שונתה מ-%' AND title ILIKE '% ל-%')
    -- Pattern with customer.category_values (old format) - more specific
    OR (
      title LIKE '%customer.category_values.%' 
      AND title LIKE '%from%' 
      AND title LIKE '%to%' 
      AND title LIKE '%by%'
      AND title NOT LIKE '%{{%'
    )
    -- Generic pattern: contains "from", "to", and "by" (category change indicator)
    OR (
      title ILIKE '%from%' 
      AND title ILIKE '% to %' 
      AND title ILIKE '% by %'
      AND title ILIKE '%category%change%'
    )
  );

-- Handle translation keys - category_change: when BOTH oldCategory and newCategory exist
UPDATE "Activity"
SET title = '{{activities.fields.category_change}}'
WHERE (
    title = '{{activity.category_change}}'
    OR title = '{{activity.log_activity.category_change}}'
    OR title = '{{activity.log_activity.category_change_title}}'
    OR title = '{{activity.manual_category_change_title}}'
    OR title = '{{activity.log_activity.manual_category_change_title}}'
    OR title = '{{activities.fields.manual_category_change_title}}'  -- Fix if already migrated wrong
)
AND (
    title_params IS NOT NULL 
    AND (title_params::text LIKE '%oldCategory%' OR title_params::text LIKE '%currentCategory%')
)
OR (
    -- Also fix incorrect previous migration where category_change was mapped to category_change_to
    title = '{{activities.fields.category_change_to}}'
    AND title_params IS NOT NULL
    AND (title_params::text LIKE '%oldCategory%' OR title_params::text LIKE '%currentCategory%')
);

-- Handle any other old category_change patterns (catch-all)
UPDATE "Activity"
SET title = '{{activities.fields.category_change}}'
WHERE title LIKE '%{{activity.%category_change%'
  AND title NOT LIKE '%{{activities.%'
  AND title_params IS NOT NULL
  AND (title_params::text LIKE '%oldCategory%' OR title_params::text LIKE '%currentCategory%')
  AND title_params::text LIKE '%newCategory%';

-- category_change_to: when ONLY newCategory exists (no oldCategory)
UPDATE "Activity"
SET title = '{{activities.fields.category_change_to}}'
WHERE title = '{{activity.category_change_to}}'
   OR title = '{{activity.log_activity.category_change_to}}';

-- Handle formatted strings for category_change_to (titles without oldCategory)
UPDATE "Activity"
SET title = '{{activities.fields.category_change_to}}'
WHERE title NOT LIKE '%{{%'
  AND (
    title LIKE 'Category changed to%'
    OR title LIKE 'קטגוריה שונתה ל-%'  -- Hebrew
  )
  AND title_params IS NOT NULL
  AND title_params::text LIKE '%newCategory%'
  AND (title_params::text NOT LIKE '%oldCategory%' AND title_params::text NOT LIKE '%currentCategory%');

-- Collection period titles
UPDATE "Activity"
SET title = '{{activities.fields.collection_period_closed_title}}'
WHERE title = '{{activity.collection_period_closed_title}}'
   OR title = '{{activity.collection_period_closed}}'
   OR title = '{{activity.log_activity.collection_period_closed_title}}';

-- Outcome values (key name: outcomes_* in values category)
UPDATE "Activity"
SET title = REGEXP_REPLACE(title, '\{\{activity\.outcomes\.', '{{activities.values.outcomes_', 'g')
WHERE title LIKE '%{{activity.outcomes.%';

-- Add activities. prefix to titles that have fields. or values. without activities.
UPDATE "Activity"
SET title = REGEXP_REPLACE(title, '\{\{fields\.', '{{activities.fields.', 'g')
WHERE title LIKE '%{{fields.%'
  AND title NOT LIKE '%{{activities.%'
  AND title NOT LIKE '%{{disputes.%';

UPDATE "Activity"
SET title = REGEXP_REPLACE(title, '\{\{values\.', '{{activities.values.', 'g')
WHERE title LIKE '%{{values.%'
  AND title NOT LIKE '%{{activities.%'
  AND title NOT LIKE '%{{disputes.%';

-- Fix activity. to activities. for remaining activity-related titles (should catch any missed patterns)
UPDATE "Activity"
SET title = REGEXP_REPLACE(title, '\{\{activity\.', '{{activities.', 'g')
WHERE title LIKE '%{{activity.%'
  AND title NOT LIKE '%{{activities.%'
  AND title NOT LIKE '%{{disputes.%'
  AND title NOT LIKE '%dispute.%';  -- Don't update dispute-related keys

-- ============================================================================
-- PART 5: UPDATE CONTENT FIELD TRANSLATION KEYS
-- Handles multiple different keys in the same content field
-- INCLUDES: All log_activity keys in content
-- FIXED: Corrected nested REGEXP_REPLACE syntax
-- ============================================================================

-- Step 1: Fix dispute patterns in content
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.log_activity\.dispute\.', '{{disputes.fields.', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activity.log_activity.dispute.%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.log_activity\.dispute_', '{{disputes.fields.', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activity.log_activity.dispute_%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.resolution\.', '{{disputes.fields.', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute.resolution.%';

-- Step 1b: Fix dispute.* patterns (missing namespace)
-- Handle patterns like {{dispute.Denied}}, {{dispute.Resolved}}, etc.
-- These need to be mapped to the correct format based on whether they're resolutions or statuses

-- Fix resolution values (Denied, Accepted, Cancelled, etc.)
-- Use case-insensitive match to catch variations (Denied, denied, DENIED, etc.)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Denied\}\}', '{{disputes.values.status_denied}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.Denied}}%' OR content ~* '\{\{dispute\.Denied\}\}')
  AND content NOT LIKE '%{{disputes.values.status_denied}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Accepted\}\}', '{{disputes.values.status_accepted}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.Accepted}}%' OR content ~* '\{\{dispute\.Accepted\}\}')
  AND content NOT LIKE '%{{disputes.values.status_accepted}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Cancelled\}\}', '{{disputes.values.status_cancelled}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.Cancelled}}%' OR content ~* '\{\{dispute\.Cancelled\}\}')
  AND content NOT LIKE '%{{disputes.values.status_cancelled}}%';

-- Fix status values (Resolved, New, Under_Review, Awaiting_Update)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Resolved\}\}', '{{disputes.values.dispute_status_resolved}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.Resolved}}%' OR content ~* '\{\{dispute\.Resolved\}\}')
  AND content NOT LIKE '%{{disputes.values.dispute_status_resolved}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.New\}\}', '{{disputes.values.dispute_status_new}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute.New}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Under_Review\}\}', '{{disputes.values.dispute_status_under_review}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute.Under_Review}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Awaiting_Update\}\}', '{{disputes.values.dispute_status_awaiting_update}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute.Awaiting_Update}}%';

-- Fix Accepted_Settled_in_full (resolution)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Accepted_Settled_in_full\}\}', '{{disputes.values.status_accepted_settled_in_full}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute.Accepted_Settled_in_full}}%';

-- Fix Accepted_Settled_partly (resolution)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Accepted_Settled_partly\}\}', '{{disputes.values.status_accepted_settled_partly}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute.Accepted_Settled_partly}}%';

-- Fix Admin_Fixed_Balance_Unchanged (resolution)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Admin_Fixed_Balance_Unchanged\}\}', '{{disputes.values.status_admin_fixed_balance_unchanged}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute.Admin_Fixed_Balance_Unchanged}}%';

-- Generic: Handle any remaining {{dispute.*}} patterns that weren't caught above
-- IMPORTANT: This runs BEFORE the generic dispute.* pattern at Step 6
-- Default to status format for unknown values, but exclude already fixed ones
UPDATE "Activity"
SET content = REGEXP_REPLACE(
    content,
    '\{\{dispute\.([A-Z][a-zA-Z_]*)\}\}',
    E'{{disputes.values.dispute_status_' || LOWER('\1') || '}}',
    'g'
)
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute.%'
  AND content NOT LIKE '%{{disputes.%'
  -- Exclude patterns that were already fixed above (must be exact matches)
  AND content !~* '\{\{dispute\.Denied\}\}'
  AND content !~* '\{\{dispute\.Accepted\}\}'
  AND content !~* '\{\{dispute\.Cancelled\}\}'
  AND content !~* '\{\{dispute\.Resolved\}\}'
  AND content !~* '\{\{dispute\.New\}\}'
  AND content !~* '\{\{dispute\.Under_Review\}\}'
  AND content !~* '\{\{dispute\.Awaiting_Update\}\}'
  AND content !~* '\{\{dispute\.Accepted_Settled_in_full\}\}'
  AND content !~* '\{\{dispute\.Accepted_Settled_partly\}\}'
  AND content !~* '\{\{dispute\.Admin_Fixed_Balance_Unchanged\}\}';

-- Step 1a: Fix dispute status values in content (dispute_status.Status_Name → disputes.values.dispute_status_status_name)
-- Handle patterns like {{dispute_status.Under_Review}}, {{disputes.dispute_status.Under_Review}}, etc.
-- Convert to {{disputes.values.dispute_status_under_review}} format

-- Fix specific known status values first (explicit mappings ensure correct format)
UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.dispute_status.Under_Review}}', '{{disputes.values.dispute_status_under_review}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.dispute_status.Under_Review}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.dispute_status.Under_Review}}', '{{disputes.values.dispute_status_under_review}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute_status.Under_Review}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.dispute_status.New}}', '{{disputes.values.dispute_status_new}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.dispute_status.New}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{dispute_status.New}}', '{{disputes.values.dispute_status_new}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute_status.New}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.dispute_status.Resolved}}', '{{disputes.values.dispute_status_resolved}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.dispute_status.Resolved}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{dispute_status.Resolved}}', '{{disputes.values.dispute_status_resolved}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute_status.Resolved}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.dispute_status.Cancelled}}', '{{disputes.values.dispute_status_cancelled}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.dispute_status.Cancelled}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{dispute_status.Cancelled}}', '{{disputes.values.dispute_status_cancelled}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute_status.Cancelled}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.dispute_status.Awaiting_Update}}', '{{disputes.values.dispute_status_awaiting_update}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.dispute_status.Awaiting_Update}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{dispute_status.Awaiting_Update}}', '{{disputes.values.dispute_status_awaiting_update}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute_status.Awaiting_Update}}%';

-- Generic pattern: Convert any remaining dispute_status.* patterns
-- Approach: Use explicit replacements for all known status values from disputes.json
-- This ensures accurate conversion: dispute_status.Status → disputes.values.dispute_status_status (lowercase)

-- Step 1: Convert namespace - {{disputes.dispute_status.X}} or {{dispute_status.X}} → {{disputes.values.dispute_status.X}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{disputes?\.dispute_status\.', '{{disputes.values.dispute_status.', 'g')
WHERE content IS NOT NULL
  AND (content LIKE '%{{disputes.dispute_status.%' OR content LIKE '%{{dispute_status.%')
  AND content NOT LIKE '%{{disputes.values.dispute_status.%';

-- Step 2: Replace dot with underscore and convert known status values to lowercase
-- Handle all known status values from disputes.json explicitly
UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.values.dispute_status.Under_Review}}', '{{disputes.values.dispute_status_under_review}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.Under_Review}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.values.dispute_status.under_review}}', '{{disputes.values.dispute_status_under_review}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.under_review}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.values.dispute_status.Awaiting_Update}}', '{{disputes.values.dispute_status_awaiting_update}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.Awaiting_Update}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.values.dispute_status.awaiting_update}}', '{{disputes.values.dispute_status_awaiting_update}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.awaiting_update}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.values.dispute_status.New}}', '{{disputes.values.dispute_status_new}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.New}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.values.dispute_status.new}}', '{{disputes.values.dispute_status_new}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.new}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.values.dispute_status.Resolved}}', '{{disputes.values.dispute_status_resolved}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.Resolved}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.values.dispute_status.resolved}}', '{{disputes.values.dispute_status_resolved}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.resolved}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.values.dispute_status.Cancelled}}', '{{disputes.values.dispute_status_cancelled}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.Cancelled}}%';

UPDATE "Activity"
SET content = REPLACE(content, '{{disputes.values.dispute_status.cancelled}}', '{{disputes.values.dispute_status_cancelled}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.cancelled}}%';

-- Generic: Replace dot with underscore and convert to lowercase for any remaining {{disputes.values.dispute_status.StatusName}} patterns
-- This converts {{disputes.values.dispute_status.X}} → {{disputes.values.dispute_status_x}} (lowercase)
-- Since PostgreSQL REGEXP_REPLACE can't apply LOWER() to backreferences directly, we use a two-step approach:
-- Step 1: Replace dot with underscore (keeping case as-is)
-- Step 2: Convert uppercase to lowercase using explicit REPLACE statements

-- Step 2a: Replace dot with underscore for any remaining {{disputes.values.dispute_status.StatusName}} patterns
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{disputes\.values\.dispute_status\.([^}]+)\}\}', '{{disputes.values.dispute_status_\1}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status.%'
  AND content NOT LIKE '%{{disputes.values.dispute_status_%';

-- Step 3: Convert any uppercase status values to lowercase
-- Since PostgreSQL REGEXP_REPLACE can't apply LOWER() to backreferences directly, 
-- we use explicit REPLACE statements for all known status values
-- This handles patterns like {{disputes.values.dispute_status_Under_Review}} → {{disputes.values.dispute_status_under_review}}
-- Also handles {{disputes.values.dispute_status_Resolved}} → {{disputes.values.dispute_status_resolved}}
UPDATE "Activity"
SET content = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    content,
    '{{disputes.values.dispute_status_Under_Review}}', '{{disputes.values.dispute_status_under_review}}'
), '{{disputes.values.dispute_status_Awaiting_Update}}', '{{disputes.values.dispute_status_awaiting_update}}'
), '{{disputes.values.dispute_status_New}}', '{{disputes.values.dispute_status_new}}'
), '{{disputes.values.dispute_status_Resolved}}', '{{disputes.values.dispute_status_resolved}}'
), '{{disputes.values.dispute_status_Cancelled}}', '{{disputes.values.dispute_status_cancelled}}')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.values.dispute_status_%'
  AND content ~ '\{\{disputes\.values\.dispute_status_[A-Z]';

-- Step 4: Handle dispute_status patterns WITHOUT brackets (plain text in content)
-- These might appear as: dispute_status.Under_Review, dispute_status.Awaiting_Update, etc.

-- Fix Awaiting_Update
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'dispute_status\.Awaiting_Update', '{{disputes.values.dispute_status_awaiting_update}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'dispute_status\.Awaiting_Update'
  AND content NOT LIKE '%{{disputes.values.dispute_status_awaiting_update}}%';

-- Fix Under_Review
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'dispute_status\.Under_Review', '{{disputes.values.dispute_status_under_review}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'dispute_status\.Under_Review'
  AND content NOT LIKE '%{{disputes.values.dispute_status_under_review}}%';

-- Fix New
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'dispute_status\.New', '{{disputes.values.dispute_status_new}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'dispute_status\.New'
  AND content NOT LIKE '%{{disputes.values.dispute_status_new}}%';

-- Fix Resolved (specific fix to ensure lowercase)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'dispute_status\.Resolved', '{{disputes.values.dispute_status_resolved}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'dispute_status\.Resolved'
  AND content NOT LIKE '%{{disputes.values.dispute_status_resolved}}%';

-- Fix Cancelled
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'dispute_status\.Cancelled', '{{disputes.values.dispute_status_cancelled}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'dispute_status\.Cancelled'
  AND content NOT LIKE '%{{disputes.values.dispute_status_cancelled}}%';

-- NOTE: Generic pattern for dispute_status.* removed because:
-- 1. PostgreSQL REGEXP_REPLACE cannot apply LOWER() to backreferences directly
-- 2. All known dispute status values (New, Under_Review, Awaiting_Update, Resolved, Cancelled) are handled explicitly above
-- 3. Resolution values (Denied, Accepted, etc.) are handled separately
-- If new status values appear, they should be added as explicit fixes above

-- Handle incorrect dispute_status.Denied (Denied is a resolution, not a status)
-- If Denied appears with dispute_status prefix, it should be treated as a resolution
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'dispute_status\.Denied', '{{disputes.values.status_denied}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'dispute_status\.Denied'
  AND content NOT LIKE '%{{disputes.values.status_denied}}%';

-- Step 2: Fix log_activity patterns in content (before generic activity.* patterns)
-- Handle special cases first before generic replacement

-- Fix log_activity.call_outcome → activities.fields.outcome
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.call_outcome\}\}', '{{activities.fields.outcome}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{log_activity.call_outcome}}%';

-- Fix log_activity.outcomes.X → activities.values.outcomes_X
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.outcomes\.([^}]+)\}\}', '{{activities.values.outcomes_\1}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{log_activity.outcomes.%';

-- Fix log_activity.agent_name → activities.fields.agent
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.agent_name\}\}', '{{activities.fields.agent}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{log_activity.agent_name}}%';

-- Fix log_activity.timezone → activities.fields.timezone
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.timezone\}\}', '{{activities.fields.timezone}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{log_activity.timezone}}%';

-- Fix log_activity.duration → activities.fields.duration
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.duration\}\}', '{{activities.fields.duration}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{log_activity.duration}}%';

-- Fix log_activity.call_direction → activities.fields.call_direction
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.call_direction\}\}', '{{activities.fields.call_direction}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{log_activity.call_direction}}%';

-- Step 2a: Fix log_activity.dispute_resolution.* patterns → disputes.values.status_*
-- Resolution values: Denied, Accepted, Accepted_Settled_in_full, Accepted_Settled_partly, Admin_Fixed_Balance_Unchanged, Cancelled

-- Fix log_activity.dispute_resolution.Denied → disputes.values.status_denied
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_resolution\.Denied\}\}', '{{disputes.values.status_denied}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_resolution\.Denied\}\}'
  AND content NOT LIKE '%{{disputes.values.status_denied}}%';

-- Fix log_activity.dispute_resolution.Accepted → disputes.values.status_accepted
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_resolution\.Accepted\}\}', '{{disputes.values.status_accepted}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_resolution\.Accepted\}\}'
  AND content NOT LIKE '%{{disputes.values.status_accepted}}%';

-- Fix log_activity.dispute_resolution.Cancelled → disputes.values.status_cancelled
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_resolution\.Cancelled\}\}', '{{disputes.values.status_cancelled}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_resolution\.Cancelled\}\}'
  AND content NOT LIKE '%{{disputes.values.status_cancelled}}%';

-- Fix log_activity.dispute_resolution.Accepted_Settled_in_full → disputes.values.status_accepted_settled_in_full
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_resolution\.Accepted_Settled_in_full\}\}', '{{disputes.values.status_accepted_settled_in_full}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_resolution\.Accepted_Settled_in_full\}\}'
  AND content NOT LIKE '%{{disputes.values.status_accepted_settled_in_full}}%';

-- Fix log_activity.dispute_resolution.Accepted_Settled_partly → disputes.values.status_accepted_settled_partly
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_resolution\.Accepted_Settled_partly\}\}', '{{disputes.values.status_accepted_settled_partly}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_resolution\.Accepted_Settled_partly\}\}'
  AND content NOT LIKE '%{{disputes.values.status_accepted_settled_partly}}%';

-- Fix log_activity.dispute_resolution.Admin_Fixed_Balance_Unchanged → disputes.values.status_admin_fixed_balance_unchanged
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_resolution\.Admin_Fixed_Balance_Unchanged\}\}', '{{disputes.values.status_admin_fixed_balance_unchanged}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_resolution\.Admin_Fixed_Balance_Unchanged\}\}'
  AND content NOT LIKE '%{{disputes.values.status_admin_fixed_balance_unchanged}}%';

-- Generic: Fix any remaining log_activity.dispute_resolution.* patterns → disputes.values.status_* (lowercase)
UPDATE "Activity"
SET content = REGEXP_REPLACE(
    content,
    '\{\{log_activity\.dispute_resolution\.([A-Z][a-zA-Z_]*)\}\}',
    E'{{disputes.values.status_' || LOWER('\1') || '}}',
    'gi'
)
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_resolution\.[A-Z]'
  AND content NOT LIKE '%{{disputes.values.status_%';

-- Step 2b: Fix log_activity.dispute_status.* patterns → disputes.values.dispute_status_*
-- Status values: New, Under_Review, Awaiting_Update, Resolved, Cancelled

-- Fix log_activity.dispute_status.Resolved → disputes.values.dispute_status_resolved
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_status\.Resolved\}\}', '{{disputes.values.dispute_status_resolved}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_status\.Resolved\}\}'
  AND content NOT LIKE '%{{disputes.values.dispute_status_resolved}}%';

-- Fix log_activity.dispute_status.New → disputes.values.dispute_status_new
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_status\.New\}\}', '{{disputes.values.dispute_status_new}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_status\.New\}\}'
  AND content NOT LIKE '%{{disputes.values.dispute_status_new}}%';

-- Fix log_activity.dispute_status.Under_Review → disputes.values.dispute_status_under_review
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_status\.Under_Review\}\}', '{{disputes.values.dispute_status_under_review}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_status\.Under_Review\}\}'
  AND content NOT LIKE '%{{disputes.values.dispute_status_under_review}}%';

-- Fix log_activity.dispute_status.Awaiting_Update → disputes.values.dispute_status_awaiting_update
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_status\.Awaiting_Update\}\}', '{{disputes.values.dispute_status_awaiting_update}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_status\.Awaiting_Update\}\}'
  AND content NOT LIKE '%{{disputes.values.dispute_status_awaiting_update}}%';

-- Fix log_activity.dispute_status.Cancelled → disputes.values.dispute_status_cancelled
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.dispute_status\.Cancelled\}\}', '{{disputes.values.dispute_status_cancelled}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_status\.Cancelled\}\}'
  AND content NOT LIKE '%{{disputes.values.dispute_status_cancelled}}%';

-- Generic: Fix any remaining log_activity.dispute_status.* patterns → disputes.values.dispute_status_* (lowercase)
UPDATE "Activity"
SET content = REGEXP_REPLACE(
    content,
    '\{\{log_activity\.dispute_status\.([A-Z][a-zA-Z_]*)\}\}',
    E'{{disputes.values.dispute_status_' || LOWER('\1') || '}}',
    'gi'
)
WHERE content IS NOT NULL
  AND content ~* '\{\{log_activity\.dispute_status\.[A-Z]'
  AND content NOT LIKE '%{{disputes.values.dispute_status_%';

-- Generic: Fix remaining log_activity.* patterns → activities.fields.log_activity_*
-- IMPORTANT: This runs AFTER specific fixes above, so exclude dispute_resolution and dispute_status patterns
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{log_activity\.', '{{activities.fields.log_activity_', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{log_activity.%'
  AND content NOT LIKE '%{{activities.%'
  -- Exclude dispute_resolution and dispute_status patterns (already fixed in Step 2a and 2b)
  AND content !~* '\{\{log_activity\.dispute_resolution\.'
  AND content !~* '\{\{log_activity\.dispute_status\.';

-- Step 2c: Handle log_activity.dispute_resolution.* and log_activity.dispute_status.* WITHOUT brackets
-- These might appear as: log_activity.dispute_resolution.Denied, log_activity.dispute_status.Resolved

-- Fix log_activity.dispute_resolution.Denied (without brackets) → {{disputes.values.status_denied}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.dispute_resolution\.Denied', '{{disputes.values.status_denied}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'log_activity\.dispute_resolution\.Denied'
  AND content NOT LIKE '%{{disputes.values.status_denied}}%';

-- Fix log_activity.dispute_resolution.Accepted (without brackets) → {{disputes.values.status_accepted}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.dispute_resolution\.Accepted', '{{disputes.values.status_accepted}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'log_activity\.dispute_resolution\.Accepted'
  AND content NOT LIKE '%{{disputes.values.status_accepted}}%';

-- Fix log_activity.dispute_resolution.Cancelled (without brackets) → {{disputes.values.status_cancelled}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.dispute_resolution\.Cancelled', '{{disputes.values.status_cancelled}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'log_activity\.dispute_resolution\.Cancelled'
  AND content NOT LIKE '%{{disputes.values.status_cancelled}}%';

-- Fix log_activity.dispute_status.Resolved (without brackets) → {{disputes.values.dispute_status_resolved}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.dispute_status\.Resolved', '{{disputes.values.dispute_status_resolved}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'log_activity\.dispute_status\.Resolved'
  AND content NOT LIKE '%{{disputes.values.dispute_status_resolved}}%';

-- Fix log_activity.dispute_status.New (without brackets) → {{disputes.values.dispute_status_new}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.dispute_status\.New', '{{disputes.values.dispute_status_new}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'log_activity\.dispute_status\.New'
  AND content NOT LIKE '%{{disputes.values.dispute_status_new}}%';

-- Fix log_activity.dispute_status.Under_Review (without brackets) → {{disputes.values.dispute_status_under_review}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.dispute_status\.Under_Review', '{{disputes.values.dispute_status_under_review}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'log_activity\.dispute_status\.Under_Review'
  AND content NOT LIKE '%{{disputes.values.dispute_status_under_review}}%';

-- Fix log_activity.dispute_status.Awaiting_Update (without brackets) → {{disputes.values.dispute_status_awaiting_update}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.dispute_status\.Awaiting_Update', '{{disputes.values.dispute_status_awaiting_update}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'log_activity\.dispute_status\.Awaiting_Update'
  AND content NOT LIKE '%{{disputes.values.dispute_status_awaiting_update}}%';

-- Fix log_activity.dispute_status.Cancelled (without brackets) → {{disputes.values.dispute_status_cancelled}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.dispute_status\.Cancelled', '{{disputes.values.dispute_status_cancelled}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* 'log_activity\.dispute_status\.Cancelled'
  AND content NOT LIKE '%{{disputes.values.dispute_status_cancelled}}%';

-- Generic: Fix any remaining log_activity.dispute_resolution.* patterns (without brackets) → disputes.values.status_* (lowercase)
UPDATE "Activity"
SET content = REGEXP_REPLACE(
    content,
    'log_activity\.dispute_resolution\.([A-Z][a-zA-Z_]*)',
    E'{{disputes.values.status_' || LOWER('\1') || '}}',
    'gi'
)
WHERE content IS NOT NULL
  AND content ~* 'log_activity\.dispute_resolution\.[A-Z]'
  AND content NOT LIKE '%{{disputes.values.status_%';

-- Generic: Fix any remaining log_activity.dispute_status.* patterns (without brackets) → disputes.values.dispute_status_* (lowercase)
UPDATE "Activity"
SET content = REGEXP_REPLACE(
    content,
    'log_activity\.dispute_status\.([A-Z][a-zA-Z_]*)',
    E'{{disputes.values.dispute_status_' || LOWER('\1') || '}}',
    'gi'
)
WHERE content IS NOT NULL
  AND content ~* 'log_activity\.dispute_status\.[A-Z]'
  AND content NOT LIKE '%{{disputes.values.dispute_status_%';

-- Step 2d: Handle log_activity.* patterns WITHOUT brackets (plain text in content)
-- These might appear as: log_activity.duration, log_activity.call_direction, log_activity.agent_name

-- Fix duration
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.duration', '{{activities.fields.duration}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%log_activity.duration%'
  AND content NOT LIKE '%{{activities.fields.duration}}%';

-- Fix call_direction
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.call_direction', '{{activities.fields.call_direction}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%log_activity.call_direction%'
  AND content NOT LIKE '%{{activities.fields.call_direction}}%';

-- Fix agent_name
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.agent_name', '{{activities.fields.agent}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%log_activity.agent_name%'
  AND content NOT LIKE '%{{activities.fields.agent}}%';

-- Fix timezone
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.timezone', '{{activities.fields.timezone}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%log_activity.timezone%'
  AND content NOT LIKE '%{{activities.fields.timezone}}%';

-- Step 3: Fix specific activity.log_activity.* patterns in content
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.log_activity\.contact\}\}', '{{activities.fields.log_activity_contact}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activity.log_activity.contact}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.log_activity\.comment\}\}', '{{activities.fields.log_activity_comment}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activity.log_activity.comment}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.log_activity\.payment_date\}\}', '{{activities.fields.log_activity_payment_date}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activity.log_activity.payment_date}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.log_activity\.incoming_call\}\}', '{{activities.fields.log_activity_incoming_call}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activity.log_activity.incoming_call}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.log_activity\.outgoing_call\}\}', '{{activities.fields.log_activity_outgoing_call}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activity.log_activity.outgoing_call}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.log_activity\.follow_up_time\}\}', '{{activities.fields.log_activity_follow_up_time}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activity.log_activity.follow_up_time}}%';

-- Step 4: Fix file_attachments pattern
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.file_attachments\.attachments\}\}', '{{activities.sections.file_attachments}}', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activity.file_attachments.attachments}}%';

-- Step 5: Fix fields.* and values.* patterns (without activities prefix)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{fields\.', '{{activities.fields.', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{fields.%'
  AND content NOT LIKE '%{{activities.%'
  AND content NOT LIKE '%{{disputes.%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{values\.', '{{activities.values.', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{values.%'
  AND content NOT LIKE '%{{activities.%'
  AND content NOT LIKE '%{{disputes.%';

-- Step 5.5: Fix activity.* patterns with spaces (like "Call Direction", "Payment Date", etc.)
-- These patterns have spaces and need special handling to convert to snake_case

-- Fix {{activity.Call Direction}} → {{activities.fields.call_direction}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.Call Direction\}\}', '{{activities.fields.call_direction}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{activity\.Call Direction\}\}'
  AND content NOT LIKE '%{{activities.fields.call_direction}}%';

-- Fix {{activity.Duration}} → {{activities.fields.duration}}
-- More aggressive: Remove NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.Duration\}\}', '{{activities.fields.duration}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{activity.Duration}}%' OR content ~* '\{\{activity\.Duration\}\}');

-- Fix {{activity.Agent}} → {{activities.fields.agent}}
-- More aggressive: Remove NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.Agent\}\}', '{{activities.fields.agent}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{activity.Agent}}%' OR content ~* '\{\{activity\.Agent\}\}');

-- Fix {{activity.Payment Date}} → {{activities.fields.log_activity_payment_date}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.Payment Date\}\}', '{{activities.fields.log_activity_payment_date}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{activity\.Payment Date\}\}'
  AND content NOT LIKE '%{{activities.fields.log_activity_payment_date}}%';

-- Fix {{activity.Follow Up}} → {{activities.fields.follow_up}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.Follow Up\}\}', '{{activities.fields.follow_up}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{activity\.Follow Up\}\}'
  AND content NOT LIKE '%{{activities.fields.follow_up}}%';

-- Fix {{activity.Comment}} → {{activities.fields.log_activity_comment}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.Comment\}\}', '{{activities.fields.log_activity_comment}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{activity\.Comment\}\}'
  AND content NOT LIKE '%{{activities.fields.log_activity_comment}}%';

-- Step 5.6: Fix activity.* patterns WITHOUT brackets (plain text)
-- These might appear as: activity.Duration, activity.Agent, etc.

-- Fix activity.Duration (without brackets) → {{activities.fields.duration}}
-- More aggressive: Remove NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'activity\.Duration', '{{activities.fields.duration}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%activity.Duration%' OR content ~* 'activity\.Duration');

-- Fix activity.Agent (without brackets) → {{activities.fields.agent}}
-- More aggressive: Remove NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'activity\.Agent', '{{activities.fields.agent}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%activity.Agent%' OR content ~* 'activity\.Agent');

-- Fix activity.Call Direction (without brackets) → {{activities.fields.call_direction}}
-- More aggressive: Remove NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'activity\.Call Direction', '{{activities.fields.call_direction}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%activity.Call Direction%' OR content ~* 'activity\.Call Direction');

-- Step 6: Fix dispute.* patterns (generic)
-- IMPORTANT: This runs AFTER specific fixes above, so exclude already-fixed patterns
-- WARNING: This converts {{dispute.X}} → {{disputes.X}}, which is NOT correct for values like Denied
-- Those should use {{disputes.values.status_denied}}, not {{disputes.Denied}}
-- So we MUST exclude all specific patterns that were fixed in Step 1b
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.', '{{disputes.', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{dispute.%'
  AND content NOT LIKE '%{{disputes.%'
  AND content NOT LIKE '%{{dispute.resolution.%'
  -- Exclude specific patterns that were already fixed above (Step 1b) - use regex for case-insensitive matching
  AND content !~* '\{\{dispute\.Denied\}\}'
  AND content !~* '\{\{dispute\.Accepted\}\}'
  AND content !~* '\{\{dispute\.Cancelled\}\}'
  AND content !~* '\{\{dispute\.Resolved\}\}'
  AND content !~* '\{\{dispute\.New\}\}'
  AND content !~* '\{\{dispute\.Under_Review\}\}'
  AND content !~* '\{\{dispute\.Awaiting_Update\}\}'
  AND content !~* '\{\{dispute\.Accepted_Settled_in_full\}\}'
  AND content !~* '\{\{dispute\.Accepted_Settled_partly\}\}'
  AND content !~* '\{\{dispute\.Admin_Fixed_Balance_Unchanged\}\}';

-- Step 7: Fix activity.* patterns (generic - must come after specific patterns)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.', '{{activities.', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activity.%'
  AND content NOT LIKE '%{{activities.%'
  AND content NOT LIKE '%{{disputes.%'
  AND content NOT LIKE '%{{activity.log_activity.dispute%';

-- Step 8: Fix double replacements (ensure no activities.activities. or disputes.disputes.)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activities\.activities\.', '{{activities.', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{activities.activities.%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{disputes\.disputes\.', '{{disputes.', 'g')
WHERE content IS NOT NULL
  AND content LIKE '%{{disputes.disputes.%';

-- ============================================================================
-- FINAL CLEANUP: Catch any remaining dispute.* patterns that might have been missed
-- ============================================================================

-- Final pass 1: Fix {{disputes.Denied}} → {{disputes.values.status_denied}} (wrongly converted by generic pattern)
-- This fixes cases where Step 6 generic pattern converted {{dispute.Denied}} → {{disputes.Denied}} (wrong)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{disputes\.Denied\}\}', '{{disputes.values.status_denied}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{disputes\.Denied\}\}'
  AND content NOT LIKE '%{{disputes.values.status_denied}}%';

-- Final pass 2: Ensure {{dispute.Denied}} is fixed (catches any remaining instances)
-- This runs at the end to catch any patterns that might have been missed
-- More aggressive: Remove NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Denied\}\}', '{{disputes.values.status_denied}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.Denied}}%' OR content ~* '\{\{dispute\.Denied\}\}');

-- Also fix other resolution patterns that might have been incorrectly converted
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{disputes\.Accepted\}\}', '{{disputes.values.status_accepted}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{disputes\.Accepted\}\}'
  AND content NOT LIKE '%{{disputes.values.status_accepted}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{disputes\.Cancelled\}\}', '{{disputes.values.status_cancelled}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{disputes\.Cancelled\}\}'
  AND content NOT LIKE '%{{disputes.values.status_cancelled}}%';

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Resolved\}\}', '{{disputes.values.dispute_status_resolved}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.Resolved}}%' OR content ~* '\{\{dispute\.Resolved\}\}');

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Awaiting_Update\}\}', '{{disputes.values.dispute_status_awaiting_update}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{dispute\.Awaiting_Update\}\}'
  AND content NOT LIKE '%{{disputes.values.dispute_status_awaiting_update}}%';

-- ============================================================================
-- PART 5.5: UPDATE title_params FIELD (JSONB)
-- Migrate translation keys stored in title_params JSON field
-- ============================================================================

-- Update oldCategory values: customer.category_values.* → customers.values.category_*
UPDATE "Activity"
SET title_params = jsonb_set(
    title_params,
    '{oldCategory}',
    to_jsonb(
        REPLACE(
            title_params->>'oldCategory',
            'customer.category_values.',
            'customers.values.category_'
        )
    )
)
WHERE title_params IS NOT NULL
  AND title_params->>'oldCategory' IS NOT NULL
  AND title_params->>'oldCategory' LIKE 'customer.category_values.%';

-- Update newCategory values: customer.category_values.* → customers.values.category_*
UPDATE "Activity"
SET title_params = jsonb_set(
    title_params,
    '{newCategory}',
    to_jsonb(
        REPLACE(
            title_params->>'newCategory',
            'customer.category_values.',
            'customers.values.category_'
        )
    )
)
WHERE title_params IS NOT NULL
  AND title_params->>'newCategory' IS NOT NULL
  AND title_params->>'newCategory' LIKE 'customer.category_values.%';

-- Update currentCategory values: customer.category_values.* → customers.values.category_*
UPDATE "Activity"
SET title_params = jsonb_set(
    title_params,
    '{currentCategory}',
    to_jsonb(
        REPLACE(
            title_params->>'currentCategory',
            'customer.category_values.',
            'customers.values.category_'
        )
    )
)
WHERE title_params IS NOT NULL
  AND title_params->>'currentCategory' IS NOT NULL
  AND title_params->>'currentCategory' LIKE 'customer.category_values.%';

-- Update reason values: activity.collection_period_closure_comment_* → activities.fields.collection_period_closure_comment_*
UPDATE "Activity"
SET title_params = jsonb_set(
    title_params,
    '{reason}',
    to_jsonb(
        REGEXP_REPLACE(
            title_params->>'reason',
            '^activity\.collection_period_closure_comment_',
            'activities.fields.collection_period_closure_comment_',
            'g'
        )
    )
)
WHERE title_params IS NOT NULL
  AND title_params->>'reason' IS NOT NULL
  AND title_params->>'reason' LIKE 'activity.collection_period_closure_comment_%';

-- ============================================================================
-- FINAL CLEANUP: Catch any remaining patterns that might have been missed
-- This section runs at the very end to ensure all patterns are properly migrated
-- ============================================================================

-- DIAGNOSTIC: Check for dispute.Denied patterns before final cleanup
SELECT 
    'DIAGNOSTIC: dispute.Denied patterns before final cleanup' as diagnostic_type,
    COUNT(*) as total_count,
    SUM(CASE WHEN content LIKE '%{{dispute.Denied}}%' THEN 1 ELSE 0 END) as has_brackets_count,
    SUM(CASE WHEN content LIKE '%dispute.Denied%' AND content NOT LIKE '%{{dispute.Denied}}%' THEN 1 ELSE 0 END) as has_unbracketed_count,
    STRING_AGG(DISTINCT substring(content, position('dispute.Denied' in content) - 50, 100), ' | ') as sample_patterns
FROM "Activity"
WHERE content IS NOT NULL
  AND (content LIKE '%dispute.Denied%' OR content ~* 'dispute\.Denied')
LIMIT 5;

-- Fix {{dispute.New}} → {{disputes.values.dispute_status_new}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.New\}\}', '{{disputes.values.dispute_status_new}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{dispute\.New\}\}'
  AND content NOT LIKE '%{{disputes.values.dispute_status_new}}%';

-- Fix {{activity.Call Direction}} → {{activities.fields.call_direction}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.Call Direction\}\}', '{{activities.fields.call_direction}}', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{activity\.Call Direction\}\}'
  AND content NOT LIKE '%{{activities.fields.call_direction}}%';

-- Fix activity.Duration (without brackets) → {{activities.fields.duration}}
-- More aggressive: Remove NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'activity\.Duration', '{{activities.fields.duration}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%activity.Duration%' OR content ~* 'activity\.Duration');

-- Fix activity.Agent (without brackets) → {{activities.fields.agent}}
-- More aggressive: Remove NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'activity\.Agent', '{{activities.fields.agent}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%activity.Agent%' OR content ~* 'activity\.Agent');

-- Fix activity.Timezone (without brackets) → {{activities.fields.timezone}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'activity\.Timezone', '{{activities.fields.timezone}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%activity.Timezone%' OR content ~* 'activity\.Timezone');

-- Fix log_activity.call_outcome (without brackets) → {{activities.fields.outcome}}
-- Note: The translation key is "outcome", not "call_outcome"
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.call_outcome', '{{activities.fields.outcome}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%log_activity.call_outcome%' OR content ~* 'log_activity\.call_outcome')
  AND content !~* '\{\{log_activity\.call_outcome\}\}'; -- Exclude already-bracketed version

-- Fix log_activity.outcomes.* (without brackets) → {{activities.values.outcomes_*}}
-- Generic pattern to handle any outcome value (e.g., schedule_follow_up)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.outcomes\.([a-zA-Z0-9_]+)', '{{activities.values.outcomes_\1}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%log_activity.outcomes.%' OR content ~* 'log_activity\.outcomes\.[a-zA-Z0-9_]+')
  AND content !~* '\{\{log_activity\.outcomes\.'; -- Exclude already-bracketed version

-- Fix log_activity.seconds → Remove this pattern (it's a unit, not a translation key)
-- This appears in content like "46 log_activity.seconds" which should be "46 seconds" (just the number and unit)
-- Or we could use a duration field, but for now just remove the translation key
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, 'log_activity\.seconds', 'seconds', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%log_activity.seconds%' OR content ~* 'log_activity\.seconds');

-- Fix double-nested patterns FIRST: {{activity.{{activities.*}}}} → {{activities.*}}
-- This fixes cases where migration created invalid double nesting for activity patterns
-- Generic pattern for activities.fields.*: Remove the outer {{activity.}} wrapper
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.(\{\{activities\.fields\.[^}]+\}\})\}\}', '\1', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{activity\.\{\{activities\.fields\.[^}]+\}\}\}\}';

-- Generic pattern for activities.values.*: Remove the outer {{activity.}} wrapper
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.(\{\{activities\.values\.[^}]+\}\})\}\}', '\1', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{activity\.\{\{activities\.values\.[^}]+\}\}\}\}';

-- Specific fixes for known double-nested activity patterns (backup in case generic doesn't catch all)
-- Fix {{activity.{{activities.fields.call_direction}}}} → {{activities.fields.call_direction}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.\{\{activities\.fields\.call_direction\}\}\}\}', '{{activities.fields.call_direction}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{activity.{{activities.fields.call_direction}}}}%' OR content ~* '\{\{activity\.\{\{activities\.fields\.call_direction\}\}\}\}');

-- Fix {{activity.{{activities.fields.duration}}}} → {{activities.fields.duration}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.\{\{activities\.fields\.duration\}\}\}\}', '{{activities.fields.duration}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{activity.{{activities.fields.duration}}}}%' OR content ~* '\{\{activity\.\{\{activities\.fields\.duration\}\}\}\}');

-- Fix {{activity.{{activities.fields.agent}}}} → {{activities.fields.agent}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.\{\{activities\.fields\.agent\}\}\}\}', '{{activities.fields.agent}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{activity.{{activities.fields.agent}}}}%' OR content ~* '\{\{activity\.\{\{activities\.fields\.agent\}\}\}\}');

-- Fix {{activity.{{activities.fields.timezone}}}} → {{activities.fields.timezone}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.\{\{activities\.fields\.timezone\}\}\}\}', '{{activities.fields.timezone}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{activity.{{activities.fields.timezone}}}}%' OR content ~* '\{\{activity\.\{\{activities\.fields\.timezone\}\}\}\}');

-- Fix {{activity.{{activities.fields.outcome}}}} → {{activities.fields.outcome}}
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.\{\{activities\.fields\.outcome\}\}\}\}', '{{activities.fields.outcome}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{activity.{{activities.fields.outcome}}}}%' OR content ~* '\{\{activity\.\{\{activities\.fields\.outcome\}\}\}\}');

-- Fix {{activity.{{activities.values.outcomes_*}}}} → {{activities.values.outcomes_*}}
-- Generic pattern for any outcome value
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.(\{\{activities\.values\.outcomes_[^}]+\}\})\}\}', '\1', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{activity\.\{\{activities\.values\.outcomes_[^}]+\}\}\}\}';

-- Fix {{activity.seconds}} → seconds (not a translation key, just plain text)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{activity\.seconds\}\}', 'seconds', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{activity.seconds}}%' OR content ~* '\{\{activity\.seconds\}\}');

-- Fix double-nested patterns: {{dispute.{{disputes.values.*}}}} → {{disputes.values.*}}
-- This fixes cases where migration created invalid double nesting
-- Generic pattern: Remove the outer {{dispute.}} wrapper from any {{dispute.{{disputes.values.*}}}} pattern
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.(\{\{disputes\.values\.[^}]+\}\})\}\}', '\1', 'gi')
WHERE content IS NOT NULL
  AND content ~* '\{\{dispute\.\{\{disputes\.values\.[^}]+\}\}\}\}';

-- Specific fixes for known double-nested patterns (backup in case generic doesn't catch all)
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.\{\{disputes\.values\.status_denied\}\}\}\}', '{{disputes.values.status_denied}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.{{disputes.values.status_denied}}}}%' OR content ~* '\{\{dispute\.\{\{disputes\.values\.status_denied\}\}\}\}');

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.\{\{disputes\.values\.dispute_status_resolved\}\}\}\}', '{{disputes.values.dispute_status_resolved}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.{{disputes.values.dispute_status_resolved}}}}%' OR content ~* '\{\{dispute\.\{\{disputes\.values\.dispute_status_resolved\}\}\}\}');

UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.\{\{disputes\.values\.dispute_status_awaiting_update\}\}\}\}', '{{disputes.values.dispute_status_awaiting_update}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.{{disputes.values.dispute_status_awaiting_update}}}}%' OR content ~* '\{\{dispute\.\{\{disputes\.values\.dispute_status_awaiting_update\}\}\}\}');

-- Fix {{dispute.Denied}} → {{disputes.values.status_denied}}
-- More aggressive: Remove the NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Denied\}\}', '{{disputes.values.status_denied}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.Denied}}%' OR content ~* '\{\{dispute\.Denied\}\}');

-- Fix {{dispute.Resolved}} → {{disputes.values.dispute_status_resolved}}
-- More aggressive: Remove the NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Resolved\}\}', '{{disputes.values.dispute_status_resolved}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.Resolved}}%' OR content ~* '\{\{dispute\.Resolved\}\}');

-- Fix {{dispute.Awaiting Update}} (with space) → {{disputes.values.dispute_status_awaiting_update}}
-- This handles the case where "Awaiting Update" has a space instead of underscore
-- More aggressive: Remove the NOT LIKE check to ensure all instances are replaced
UPDATE "Activity"
SET content = REGEXP_REPLACE(content, '\{\{dispute\.Awaiting Update\}\}', '{{disputes.values.dispute_status_awaiting_update}}', 'gi')
WHERE content IS NOT NULL
  AND (content LIKE '%{{dispute.Awaiting Update}}%' OR content ~* '\{\{dispute\.Awaiting Update\}\}');

COMMIT;

-- ============================================================================
-- PART 6: VERIFICATION QUERIES (Run after migration)
-- ============================================================================

-- Check for remaining old format keys in titles (activity-related)
SELECT DISTINCT title, COUNT(*) as count
FROM "Activity"
WHERE title IS NOT NULL 
  AND (title LIKE '%{{activity.%' OR title LIKE '%{{fields.%' OR title LIKE '%{{values.%')
  AND title NOT LIKE '%{{activities.%'
  AND title NOT LIKE '%{{disputes.%'
GROUP BY title
ORDER BY count DESC
LIMIT 20;

-- Check for remaining old format keys in titles (dispute-related)
SELECT DISTINCT title, COUNT(*) as count
FROM "Activity"
WHERE title IS NOT NULL 
  AND (title LIKE '%{{dispute.%' OR title LIKE '%{{activity.log_activity.dispute%')
  AND title NOT LIKE '%{{disputes.%'
GROUP BY title
ORDER BY count DESC
LIMIT 20;

-- Check for remaining old format keys in content
SELECT 
    id,
    title,
    substring(content, 1, 200) as content_preview
FROM "Activity"
WHERE content IS NOT NULL 
  AND (content LIKE '%{{activity.%' OR content LIKE '%{{fields.%' OR content LIKE '%{{values.%' OR content LIKE '%{{dispute.%' OR content LIKE '%{{log_activity.%')
  AND content NOT LIKE '%{{activities.%'
  AND content NOT LIKE '%{{disputes.%'
LIMIT 20;

-- Summary of titles after migration
SELECT 
    CASE 
        WHEN title LIKE '%{{activities.fields.%' THEN 'activities.fields.*'
        WHEN title LIKE '%{{activities.values.%' THEN 'activities.values.*'
        WHEN title LIKE '%{{activities.sections.%' THEN 'activities.sections.*'
        WHEN title LIKE '%{{disputes.fields.%' THEN 'disputes.fields.*'
        WHEN title LIKE '%{{disputes.values.%' THEN 'disputes.values.*'
        WHEN title LIKE '%{{%' THEN 'Other translation key format'
        ELSE 'No translation key'
    END as title_format,
    COUNT(*) as count
FROM "Activity"
WHERE title IS NOT NULL
GROUP BY title_format
ORDER BY count DESC;

-- Find content fields that have multiple different translation keys (verify they're all updated)
WITH content_keys AS (
    SELECT 
        id,
        content,
        REGEXP_MATCHES(content, '\{\{([a-zA-Z0-9_.]+)\}\}', 'g') AS key_match
    FROM "Activity"
    WHERE content IS NOT NULL 
        AND content LIKE '%{{%'
),
extracted_keys AS (
    SELECT 
        id,
        content,
        (key_match[1])::text AS translation_key
    FROM content_keys
),
key_counts AS (
    SELECT 
        id,
        COUNT(DISTINCT translation_key) as unique_key_count,
        array_agg(DISTINCT translation_key) as all_keys
    FROM extracted_keys
    GROUP BY id
)
SELECT 
    id,
    unique_key_count,
    all_keys,
    substring(content, 1, 300) as content_preview
FROM key_counts
WHERE unique_key_count > 1
ORDER BY unique_key_count DESC
LIMIT 20;

-- Category change verification
SELECT 
    CASE
        WHEN title = '{{activities.fields.category_change}}' THEN 'CORRECT: category_change'
        WHEN title = '{{activities.fields.category_change_to}}' THEN 'CORRECT: category_change_to'
        WHEN title = '{{activities.fields.manual_category_change_title}}' THEN 'NEEDS FIX: manual_category_change_title (key does not exist)'
        WHEN title LIKE '%category_change%' AND title NOT LIKE '%activities.fields.%' THEN 'NEEDS MIGRATION: ' || title
        ELSE 'OTHER: ' || title
    END as migration_status,
    COUNT(*) as count
FROM "Activity"
WHERE title IS NOT NULL
  AND title LIKE '%category_change%'
GROUP BY migration_status
ORDER BY count DESC;

-- Log activity keys verification (check if any old patterns remain in content)
SELECT 
    'log_activity patterns in content' as check_type,
    COUNT(*) as count
FROM "Activity"
WHERE content IS NOT NULL
  AND (
    content LIKE '%{{log_activity.%'
    OR content LIKE '%{{activity.log_activity.%'
  )
  AND content NOT LIKE '%{{activities.fields.log_activity_%'
  AND content NOT LIKE '%{{activities.%';

-- Verify formatted category change titles were converted
SELECT 
    id,
    title,
    CASE 
        WHEN title = '{{activities.fields.category_change}}' THEN 'CONVERTED ✓'
        WHEN title LIKE '%{{activities.fields.category_change%' THEN 'PARTIALLY CONVERTED'
        WHEN title NOT LIKE '%{{%' AND title ILIKE '%category changed from%' THEN 'NOT CONVERTED - formatted string'
        ELSE 'OTHER: ' || substring(title, 1, 50)
    END as conversion_status
FROM "Activity"
WHERE title IS NOT NULL
  AND (
    title ILIKE '%category changed from%'
    OR title LIKE '%customer.category_values.%'
    OR title = '{{activities.fields.category_change}}'
  )
ORDER BY created_at DESC
LIMIT 20;

-- Verify dispute.* patterns were migrated in content
SELECT 
    id,
    title,
    substring(content, 1, 200) as content_preview,
    CASE 
        WHEN content LIKE '%{{dispute.Denied}}%' THEN 'NEEDS FIX: {{dispute.Denied}}'
        WHEN content LIKE '%{{dispute.Resolved}}%' THEN 'NEEDS FIX: {{dispute.Resolved}}'
        WHEN content LIKE '%{{dispute.Accepted}}%' THEN 'NEEDS FIX: {{dispute.Accepted}}'
        WHEN content LIKE '%{{dispute.Awaiting_Update}}%' THEN 'NEEDS FIX: {{dispute.Awaiting_Update}}'
        WHEN content LIKE '%{{disputes.values.status_denied}}%' THEN 'OK ✓: status_denied'
        WHEN content LIKE '%{{disputes.values.dispute_status_resolved}}%' THEN 'OK ✓: dispute_status_resolved'
        ELSE 'OTHER'
    END as migration_status
FROM "Activity"
WHERE content IS NOT NULL
  AND (
    content LIKE '%{{dispute.Denied}}%'
    OR content LIKE '%{{dispute.Resolved}}%'
    OR content LIKE '%{{dispute.Accepted}}%'
    OR content LIKE '%{{dispute.Awaiting_Update}}%'
    OR content LIKE '%{{disputes.values.status_denied}}%'
    OR content LIKE '%{{disputes.values.dispute_status_resolved}}%'
  )
ORDER BY created_at DESC
LIMIT 20;

-- Verify title_params migration: Check for remaining old format keys
SELECT 
    id,
    title,
    title_params->>'oldCategory' as old_category,
    title_params->>'newCategory' as new_category,
    title_params->>'currentCategory' as current_category,
    title_params->>'reason' as reason,
    CASE 
        WHEN title_params->>'oldCategory' LIKE 'customer.category_values.%' THEN 'NEEDS FIX: oldCategory'
        WHEN title_params->>'newCategory' LIKE 'customer.category_values.%' THEN 'NEEDS FIX: newCategory'
        WHEN title_params->>'currentCategory' LIKE 'customer.category_values.%' THEN 'NEEDS FIX: currentCategory'
        WHEN title_params->>'reason' LIKE 'activity.collection_period_closure_comment_%' THEN 'NEEDS FIX: reason'
        ELSE 'OK ✓'
    END as params_status
FROM "Activity"
WHERE title_params IS NOT NULL
  AND (
    (title_params->>'oldCategory' IS NOT NULL AND title_params->>'oldCategory' LIKE 'customer.category_values.%')
    OR (title_params->>'newCategory' IS NOT NULL AND title_params->>'newCategory' LIKE 'customer.category_values.%')
    OR (title_params->>'currentCategory' IS NOT NULL AND title_params->>'currentCategory' LIKE 'customer.category_values.%')
    OR (title_params->>'reason' IS NOT NULL AND title_params->>'reason' LIKE 'activity.collection_period_closure_comment_%')
  )
LIMIT 20;

-- Summary of title_params migration status
SELECT 
    CASE 
        WHEN title_params->>'oldCategory' LIKE 'customer.category_values.%' THEN 'oldCategory: NEEDS FIX'
        WHEN title_params->>'oldCategory' LIKE 'customers.values.category_%' THEN 'oldCategory: OK ✓'
        WHEN title_params->>'newCategory' LIKE 'customer.category_values.%' THEN 'newCategory: NEEDS FIX'
        WHEN title_params->>'newCategory' LIKE 'customers.values.category_%' THEN 'newCategory: OK ✓'
        WHEN title_params->>'reason' LIKE 'activity.collection_period_closure_comment_%' THEN 'reason: NEEDS FIX'
        WHEN title_params->>'reason' LIKE 'activities.fields.collection_period_closure_comment_%' THEN 'reason: OK ✓'
        ELSE 'No translation keys in params'
    END as migration_status,
    COUNT(*) as count
FROM "Activity"
WHERE title_params IS NOT NULL
  AND (
    (title_params->>'oldCategory' IS NOT NULL)
    OR (title_params->>'newCategory' IS NOT NULL)
    OR (title_params->>'reason' IS NOT NULL AND title_params->>'reason' LIKE '%collection_period_closure_comment_%')
  )
GROUP BY migration_status
ORDER BY count DESC;

-- ============================================================================
-- ROLLBACK (if needed)
-- ============================================================================

-- If something goes wrong, you can rollback and restore from backup:
-- ROLLBACK;
-- TRUNCATE "Activity";
-- INSERT INTO "Activity" SELECT * FROM "Activity_backup_before_translation_migration";

