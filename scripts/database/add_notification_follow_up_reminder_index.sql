-- ============================================================================
-- Add partial index on Notification for follow-up reminder state lookups
-- ============================================================================
-- Used by: follow-up reminder feature (Section 6.3 Option B)
-- Queries: WHERE user_id = $1 AND (metadata->>'followUpReminder') = 'true'
-- The partial index only includes rows where metadata->>'followUpReminder' = 'true',
-- so lookups for "dismissed/snoozed" state per user are fast.
--
-- Run manually before or as part of deployment.
-- For zero-downtime on a large Notification table, run outside a transaction:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_user_follow_up_reminder
--     ON "Notification" (user_id) WHERE (metadata->>'followUpReminder') = 'true';
-- ============================================================================

-- Idempotent: create index only if it does not exist
CREATE INDEX IF NOT EXISTS idx_notification_user_follow_up_reminder
  ON "Notification" (user_id)
  WHERE (metadata->>'followUpReminder') = 'true';
