-- Remove policy now saves a Removed row: CustomerPolicy with no insurance
-- policy, inactive, open end (policy_change_end_date IS NULL). Cancelling a
-- pending change now voids it (end = start); cancelled pending unassigns saved
-- before this change look like Removed rows and would stop coverage.
-- Void them. An applied Remove is saved on/after its start day, so a row last
-- modified before its start day was cancelled. modified_at is left unchanged.
-- Apply: npx prisma db execute --file prisma/migrations/20261011_void_cancelled_pending_unassign.sql

UPDATE "CustomerPolicy"
SET policy_change_end_date = policy_change_start_date
WHERE insurance_policy_id IS NULL
  AND is_active = FALSE
  AND status = 'inactive'::customer_policy_status
  AND policy_change_end_date IS NULL
  AND (modified_at AT TIME ZONE 'UTC')::date < policy_change_start_date;
