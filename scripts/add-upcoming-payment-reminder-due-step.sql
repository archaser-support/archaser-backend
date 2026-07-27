-- =============================================================================
-- Add "Upcoming Payment Reminder" due step to Standard Sequence for all accounts
-- =============================================================================
-- Run this AFTER copy-activity-template-1795.sql has been run.
-- For each account that has:
--   - The "Upcoming Payment Reminder" template
--   - A default Automated sequence container (Standard Sequence)
-- this inserts one due activity sequence step: 2 days before due at 09:00,
-- notifying both standard and escalated contacts.
-- =============================================================================

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
  activity_template_id,
  master_template,
  created_at,
  modified_at
)
SELECT
  t.account_id,
  sc.id,
  'Automated'::category,
  NULL,
  'due'::step_type,
  2,
  'Email'::activity_type,
  '09:00',
  true,
  false,
  true,
  true,
  t.id,
  (t.account_id = 10013),
  NOW(),
  NOW()
FROM "ActivitiesTemplate" t
JOIN "SequenceContainer" sc
  ON sc.account_id = t.account_id
  AND sc.category = 'Automated'
  AND sc.is_default = true
  AND sc.active = true
  AND (sc.is_deleted = false OR sc.is_deleted IS NULL)
WHERE t.name = 'Upcoming Payment Reminder'
AND NOT EXISTS (
  SELECT 1
  FROM "ActivitiesSequence" aseq
  WHERE aseq.sequence_container_id = sc.id
    AND aseq.activity_template_id = t.id
    AND aseq.step_type = 'due'
    AND aseq.days_before_due = 2
);
