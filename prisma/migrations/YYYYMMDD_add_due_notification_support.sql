-- ============================================================================
-- Migration Script: Add Due Notification Support
-- Context: Due invoice notifications - sequence-based design
-- ============================================================================
--
-- 1. ActivitiesSequence: Add step_type enum and column; add days_before_due
-- 2. Activity: Add invoice_id; make collection_period_id nullable
-- 3. Add index on Activity (invoice_id, activity_sequence_id) for deduplication
--
-- IMPORTANT: Execute manually (DBeaver). After running, run: npx prisma generate
-- ============================================================================

BEGIN;

-- 1. Create step_type enum for ActivitiesSequence
DO $$ BEGIN
    CREATE TYPE "step_type" AS ENUM ('due', 'overdue');
EXCEPTION
    WHEN duplicate_object THEN NULL; -- enum already exists
END $$;

-- 2. Add step_type and days_before_due to ActivitiesSequence
ALTER TABLE "ActivitiesSequence" ADD COLUMN IF NOT EXISTS "step_type" "step_type" DEFAULT 'overdue';
ALTER TABLE "ActivitiesSequence" ADD COLUMN IF NOT EXISTS "days_before_due" INTEGER;

-- 3. Set existing rows to overdue (null handling)
UPDATE "ActivitiesSequence" SET step_type = 'overdue' WHERE step_type IS NULL;

-- 4. Add invoice_id to Activity
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "invoice_id" INTEGER;

-- 5. Add FK for invoice_id (only if column was just added - FK may fail if column exists with data)
DO $$ BEGIN
    ALTER TABLE "Activity" ADD CONSTRAINT "Activity_invoice_id_fkey"
        FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
    WHEN duplicate_object THEN NULL; -- constraint already exists
END $$;

-- 6. Make collection_period_id nullable
ALTER TABLE "Activity" ALTER COLUMN "collection_period_id" DROP NOT NULL;

-- 7. Add index for deduplication lookups (invoice_id + activity_sequence_id)
CREATE INDEX IF NOT EXISTS "idx_activity_invoice_sequence" ON "Activity"("invoice_id", "activity_sequence_id");

COMMIT;

-- ============================================================================
-- Verification queries:
--
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_name = 'ActivitiesSequence' AND column_name IN ('step_type', 'days_before_due');
--
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_name = 'Activity' AND column_name IN ('invoice_id', 'collection_period_id');
-- ============================================================================
