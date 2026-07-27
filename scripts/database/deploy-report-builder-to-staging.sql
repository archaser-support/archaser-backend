-- ============================================================================
-- Report Builder Database Migration for Staging Deployment
-- Branch: feature/report-builder
-- ============================================================================
-- 
-- This script consolidates all database changes related to the report builder
-- feature. Execute this script on the staging database before deploying the
-- application code.
--
-- IMPORTANT NOTES:
-- 1. This script uses transactions - if any step fails, the entire migration
--    will rollback.
-- 2. All operations use IF NOT EXISTS / IF EXISTS checks to be idempotent
-- 3. After running this script, regenerate Prisma client: npx prisma generate
-- 4. Verify the migration: Check that all tables and indexes were created
--
-- Execution order:
-- 1. Review this script
-- 2. Backup staging database
-- 3. Execute this script on staging database
-- 4. Run: npx prisma generate
-- 5. Deploy application code
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create Report table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "Report" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000),
    "report_config" JSONB NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR,
    "modified_by" VARCHAR,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- STEP 2: Create ReportShare table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "ReportShare" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "shared_with_user_id" VARCHAR,
    "shared_with_role" user_role,
    "permission" VARCHAR(20) NOT NULL DEFAULT 'view',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR,

    CONSTRAINT "ReportShare_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- STEP 3: Create ReportSchedule table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "ReportSchedule" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "schedule_type" VARCHAR(20) NOT NULL,
    "schedule_config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMPTZ(6),
    "next_run_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- STEP 4: Create ReportExecution table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "ReportExecution" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "executed_by" VARCHAR,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "execution_config" JSONB,
    "result_count" INTEGER,
    "execution_time_ms" INTEGER,

    CONSTRAINT "ReportExecution_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- STEP 5: Add additional columns to Report table (is_system, context, is_default)
-- ============================================================================
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "context" VARCHAR(50);
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- STEP 6: Create UserDefaultReport table
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
-- STEP 7: Add foreign key constraints for Report table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Report_account_id_fkey'
    ) THEN
        ALTER TABLE "Report" ADD CONSTRAINT "Report_account_id_fkey" 
            FOREIGN KEY ("account_id") REFERENCES "Account"("id") 
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Report_created_by_fkey'
    ) THEN
        ALTER TABLE "Report" ADD CONSTRAINT "Report_created_by_fkey" 
            FOREIGN KEY ("created_by") REFERENCES "User"("id") 
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Report_modified_by_fkey'
    ) THEN
        ALTER TABLE "Report" ADD CONSTRAINT "Report_modified_by_fkey" 
            FOREIGN KEY ("modified_by") REFERENCES "User"("id") 
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

-- ============================================================================
-- STEP 8: Add foreign key constraints for ReportShare table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ReportShare_report_id_fkey'
    ) THEN
        ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_report_id_fkey" 
            FOREIGN KEY ("report_id") REFERENCES "Report"("id") 
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ReportShare_shared_with_user_id_fkey'
    ) THEN
        ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_shared_with_user_id_fkey" 
            FOREIGN KEY ("shared_with_user_id") REFERENCES "User"("id") 
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ReportShare_created_by_fkey'
    ) THEN
        ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_created_by_fkey" 
            FOREIGN KEY ("created_by") REFERENCES "User"("id") 
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

-- ============================================================================
-- STEP 9: Add foreign key constraints for ReportSchedule table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ReportSchedule_report_id_fkey'
    ) THEN
        ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_report_id_fkey" 
            FOREIGN KEY ("report_id") REFERENCES "Report"("id") 
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

-- ============================================================================
-- STEP 10: Add foreign key constraints for ReportExecution table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ReportExecution_report_id_fkey'
    ) THEN
        ALTER TABLE "ReportExecution" ADD CONSTRAINT "ReportExecution_report_id_fkey" 
            FOREIGN KEY ("report_id") REFERENCES "Report"("id") 
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ReportExecution_executed_by_fkey'
    ) THEN
        ALTER TABLE "ReportExecution" ADD CONSTRAINT "ReportExecution_executed_by_fkey" 
            FOREIGN KEY ("executed_by") REFERENCES "User"("id") 
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

-- ============================================================================
-- STEP 11: Add foreign key constraints for UserDefaultReport table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserDefaultReport_user_id_fkey'
    ) THEN
        ALTER TABLE "UserDefaultReport" ADD CONSTRAINT "UserDefaultReport_user_id_fkey" 
            FOREIGN KEY ("user_id") REFERENCES "User"("id") 
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserDefaultReport_report_id_fkey'
    ) THEN
        ALTER TABLE "UserDefaultReport" ADD CONSTRAINT "UserDefaultReport_report_id_fkey" 
            FOREIGN KEY ("report_id") REFERENCES "Report"("id") 
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

-- ============================================================================
-- STEP 12: Create indexes for Report table
-- ============================================================================
CREATE INDEX IF NOT EXISTS "idx_report_account_id" ON "Report"("account_id");
CREATE INDEX IF NOT EXISTS "idx_report_created_by" ON "Report"("created_by");
CREATE INDEX IF NOT EXISTS "idx_report_modified_by" ON "Report"("modified_by");
CREATE INDEX IF NOT EXISTS "idx_report_is_public" ON "Report"("is_public");
CREATE INDEX IF NOT EXISTS "idx_report_is_system" ON "Report"("is_system");
CREATE INDEX IF NOT EXISTS "idx_report_context" ON "Report"("context");
CREATE INDEX IF NOT EXISTS "idx_report_system_context" ON "Report"("is_system", "context");
CREATE INDEX IF NOT EXISTS "idx_report_default_context" ON "Report"("is_default", "context");

-- ============================================================================
-- STEP 13: Create indexes and unique constraints for ReportShare table
-- ============================================================================
CREATE INDEX IF NOT EXISTS "idx_report_share_report_id" ON "ReportShare"("report_id");
CREATE INDEX IF NOT EXISTS "idx_report_share_user_id" ON "ReportShare"("shared_with_user_id");
CREATE INDEX IF NOT EXISTS "idx_report_share_role" ON "ReportShare"("shared_with_role");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_report_share_user'
    ) THEN
        ALTER TABLE "ReportShare" ADD CONSTRAINT "unique_report_share_user" 
            UNIQUE ("report_id", "shared_with_user_id");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_report_share_role'
    ) THEN
        ALTER TABLE "ReportShare" ADD CONSTRAINT "unique_report_share_role" 
            UNIQUE ("report_id", "shared_with_role");
    END IF;
END $$;

-- ============================================================================
-- STEP 14: Create indexes for ReportSchedule table
-- ============================================================================
CREATE INDEX IF NOT EXISTS "idx_report_schedule_report_id" ON "ReportSchedule"("report_id");
CREATE INDEX IF NOT EXISTS "idx_report_schedule_is_active" ON "ReportSchedule"("is_active");
CREATE INDEX IF NOT EXISTS "idx_report_schedule_next_run_at" ON "ReportSchedule"("next_run_at");

-- ============================================================================
-- STEP 15: Create indexes for ReportExecution table
-- ============================================================================
CREATE INDEX IF NOT EXISTS "idx_report_execution_report_id" ON "ReportExecution"("report_id");
CREATE INDEX IF NOT EXISTS "idx_report_execution_executed_by" ON "ReportExecution"("executed_by");
CREATE INDEX IF NOT EXISTS "idx_report_execution_executed_at" ON "ReportExecution"("executed_at");

-- ============================================================================
-- STEP 16: Create indexes and unique constraint for UserDefaultReport table
-- ============================================================================
CREATE INDEX IF NOT EXISTS "idx_user_default_report_user_id" ON "UserDefaultReport"("user_id");
CREATE INDEX IF NOT EXISTS "idx_user_default_report_context" ON "UserDefaultReport"("context");
CREATE INDEX IF NOT EXISTS "idx_user_default_report_user_context" ON "UserDefaultReport"("user_id", "context");
CREATE INDEX IF NOT EXISTS "idx_user_default_report_report_id" ON "UserDefaultReport"("report_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_default_report'
    ) THEN
        ALTER TABLE "UserDefaultReport" ADD CONSTRAINT "unique_user_default_report" 
            UNIQUE ("user_id", "context");
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- Migration completed successfully
-- ============================================================================
-- Next steps:
-- 1. Verify tables exist:
--    SELECT table_name FROM information_schema.tables 
--    WHERE table_schema = 'public' 
--    AND table_name IN ('Report', 'ReportShare', 'ReportSchedule', 'ReportExecution', 'UserDefaultReport');
--
-- 2. Verify indexes exist:
--    SELECT indexname FROM pg_indexes 
--    WHERE schemaname = 'public' 
--    AND indexname LIKE 'idx_report%' OR indexname LIKE 'idx_user_default_report%';
--
-- 3. Run: npx prisma generate (to regenerate Prisma client)
--
-- 4. Deploy application code
-- ============================================================================


