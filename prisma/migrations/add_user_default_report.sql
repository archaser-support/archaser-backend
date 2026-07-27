-- Migration: Add UserDefaultReport table
-- This script creates the UserDefaultReport table for storing user-specific default reports per context
--
-- IMPORTANT: Execute this script manually on your database.
-- After running, regenerate Prisma client: npx prisma generate

BEGIN;

-- ============================================================================
-- STEP 1: Create UserDefaultReport table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "UserDefaultReport" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR NOT NULL,
    "context" VARCHAR(50) NOT NULL,
    "report_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDefaultReport_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- STEP 2: Add foreign key constraints
-- ============================================================================
DO $$
BEGIN
    -- Add foreign key to User table
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserDefaultReport_user_id_fkey'
    ) THEN
        ALTER TABLE "UserDefaultReport" ADD CONSTRAINT "UserDefaultReport_user_id_fkey" 
            FOREIGN KEY ("user_id") REFERENCES "User"("id") 
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;

    -- Add foreign key to Report table
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserDefaultReport_report_id_fkey'
    ) THEN
        ALTER TABLE "UserDefaultReport" ADD CONSTRAINT "UserDefaultReport_report_id_fkey" 
            FOREIGN KEY ("report_id") REFERENCES "Report"("id") 
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Create unique constraint (one default per user per context)
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_default_report'
    ) THEN
        ALTER TABLE "UserDefaultReport" ADD CONSTRAINT "unique_user_default_report" 
            UNIQUE ("user_id", "context");
    END IF;
END $$;

-- ============================================================================
-- STEP 4: Create indexes for efficient querying
-- ============================================================================
CREATE INDEX IF NOT EXISTS "idx_user_default_report_user_id" ON "UserDefaultReport"("user_id");
CREATE INDEX IF NOT EXISTS "idx_user_default_report_context" ON "UserDefaultReport"("context");
CREATE INDEX IF NOT EXISTS "idx_user_default_report_user_context" ON "UserDefaultReport"("user_id", "context");
CREATE INDEX IF NOT EXISTS "idx_user_default_report_report_id" ON "UserDefaultReport"("report_id");

COMMIT;

