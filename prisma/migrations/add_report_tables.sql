-- Migration: Add Report Builder Tables
-- This script creates the Report, ReportShare, ReportSchedule, and ReportExecution tables
--
-- IMPORTANT: Execute this script manually on your database if needed.
-- This migration uses transactions - if any step fails, the entire migration will rollback.
--
-- Execution order:
-- 1. User executes this SQL script manually (if db push hasn't been run)
-- 2. Run: npx prisma generate (to regenerate Prisma client)
--
-- NOTE: If you've already run `npx prisma db push`, the tables may already exist.
-- This file serves as documentation and for manual migration if needed.

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
-- STEP 5: Add foreign key constraints
-- ============================================================================
-- Report foreign keys
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

-- ReportShare foreign keys
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

-- ReportSchedule foreign keys
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

-- ReportExecution foreign keys
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
-- STEP 6: Create indexes
-- ============================================================================
-- Report indexes
CREATE INDEX IF NOT EXISTS "idx_report_account_id" ON "Report"("account_id");
CREATE INDEX IF NOT EXISTS "idx_report_created_by" ON "Report"("created_by");
CREATE INDEX IF NOT EXISTS "idx_report_modified_by" ON "Report"("modified_by");
CREATE INDEX IF NOT EXISTS "idx_report_is_public" ON "Report"("is_public");

-- ReportShare indexes
CREATE INDEX IF NOT EXISTS "idx_report_share_report_id" ON "ReportShare"("report_id");
CREATE INDEX IF NOT EXISTS "idx_report_share_user_id" ON "ReportShare"("shared_with_user_id");
CREATE INDEX IF NOT EXISTS "idx_report_share_role" ON "ReportShare"("shared_with_role");

-- ReportShare unique constraints
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

-- ReportSchedule indexes
CREATE INDEX IF NOT EXISTS "idx_report_schedule_report_id" ON "ReportSchedule"("report_id");
CREATE INDEX IF NOT EXISTS "idx_report_schedule_is_active" ON "ReportSchedule"("is_active");
CREATE INDEX IF NOT EXISTS "idx_report_schedule_next_run_at" ON "ReportSchedule"("next_run_at");

-- ReportExecution indexes
CREATE INDEX IF NOT EXISTS "idx_report_execution_report_id" ON "ReportExecution"("report_id");
CREATE INDEX IF NOT EXISTS "idx_report_execution_executed_by" ON "ReportExecution"("executed_by");
CREATE INDEX IF NOT EXISTS "idx_report_execution_executed_at" ON "ReportExecution"("executed_at");

COMMIT;

-- ============================================================================
-- Migration completed successfully
-- ============================================================================
-- Next steps:
-- 1. Run: npx prisma generate (if not already done)
-- 2. Verify tables exist: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'Report%';
-- ============================================================================

