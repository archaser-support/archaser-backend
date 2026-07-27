-- ============================================================================
-- Schema change + data fix: due_notification_state on Invoice; due step = null; overdue renumber 1,2,3
-- Matches prisma/schema.prisma: Invoice.due_notification_state (Json?)
-- Idempotent where possible (ADD COLUMN IF NOT EXISTS; backfill merges with existing JSON).
-- Run manually; then run: npx prisma generate
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Schema: Add due_notification_state to Invoice (nullable JSONB)
-- ----------------------------------------------------------------------------
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "due_notification_state" JSONB;

-- ----------------------------------------------------------------------------
-- 2. Data fix (Invoice): Backfill due_notification_state from Activity
-- For each Activity with invoice_id and ActivitiesSequence.step_type = 'due',
-- set key "<activity_sequence_id>" to "scheduled" or "sent"; merge with existing JSON.
-- ----------------------------------------------------------------------------
WITH backfill AS (
  SELECT
    a.invoice_id,
    jsonb_object_agg(
      a.activity_sequence_id::text,
      CASE WHEN a.status IN ('SENT', 'DELIVERED') THEN 'sent' ELSE 'scheduled' END
    ) AS state
  FROM "Activity" a
  INNER JOIN "ActivitiesSequence" s ON s.id = a.activity_sequence_id AND s.step_type = 'due'
  WHERE a.invoice_id IS NOT NULL
  GROUP BY a.invoice_id
)
UPDATE "Invoice" i
SET due_notification_state = COALESCE(i.due_notification_state, '{}'::jsonb) || b.state
FROM backfill b
WHERE i.id = b.invoice_id;

-- ----------------------------------------------------------------------------
-- 3. Data fix (ActivitiesSequence): Set step = NULL for due steps
-- ----------------------------------------------------------------------------
UPDATE "ActivitiesSequence"
SET step = NULL
WHERE step_type = 'due';

-- ----------------------------------------------------------------------------
-- 4. Data fix (ActivitiesSequence): Renumber overdue steps 1, 2, 3 per container
-- Order: step NULLS LAST, days_from_prev_step, id to match application order.
-- ----------------------------------------------------------------------------
WITH ordered AS (
  SELECT
    id,
    account_id,
    sequence_container_id,
    row_number() OVER (
      PARTITION BY account_id, COALESCE(sequence_container_id, 0)
      ORDER BY step NULLS LAST, days_from_prev_step NULLS LAST, id
    ) AS rn
  FROM "ActivitiesSequence"
  WHERE step_type IS NULL OR step_type = 'overdue'
)
UPDATE "ActivitiesSequence" s
SET step = ordered.rn::smallint
FROM ordered
WHERE s.id = ordered.id;

COMMIT;

-- ============================================================================
-- Verification (optional):
-- SELECT id, due_notification_state FROM "Invoice" WHERE due_notification_state IS NOT NULL LIMIT 5;
-- SELECT id, step_type, step FROM "ActivitiesSequence" ORDER BY account_id, sequence_container_id, step;
-- ============================================================================
