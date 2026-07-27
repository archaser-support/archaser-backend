-- Migration: Add Cron Job Monitoring Fields and Tables
-- This script adds performance tracking fields to CronJob table and creates CronJobExecution table
--
-- IMPORTANT: Execute this script manually on your database.
-- This migration uses transactions - if any step fails, the entire migration will rollback.
--
-- Execution order:
-- 1. User executes this SQL script manually
-- 2. Run: npx prisma generate (to regenerate Prisma client)
--
-- NOTE: As of the MongoDB migration, STEP 1 (execution_status enum) and STEP 3-4 (CronJobExecution table)
-- are OBSOLETE. These have been migrated to MongoDB. Only STEP 2 (CronJob fields) and STEP 5 (CronJob indexes)
-- are still relevant for PostgreSQL. If you need to clean up, use:
-- scripts/database/remove-cron-job-execution-from-postgres.sh

BEGIN;

-- ============================================================================
-- STEP 1: Create execution_status enum
-- ============================================================================
-- OBSOLETE: This enum was used for CronJobExecution table which has been migrated to MongoDB.
-- This step is kept for historical reference only. If you need to clean up, use:
-- scripts/database/remove-cron-job-execution-from-postgres.sh
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'execution_status') THEN
        CREATE TYPE execution_status AS ENUM ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED');
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Add new fields to CronJob table
-- ============================================================================
DO $$
BEGIN
    -- Add last_execution_duration_seconds if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'last_execution_duration_seconds'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "last_execution_duration_seconds" INTEGER;
    END IF;

    -- Add average_execution_duration_seconds if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'average_execution_duration_seconds'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "average_execution_duration_seconds" INTEGER;
    END IF;

    -- Add min_execution_duration_seconds if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'min_execution_duration_seconds'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "min_execution_duration_seconds" INTEGER;
    END IF;

    -- Add max_execution_duration_seconds if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'max_execution_duration_seconds'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "max_execution_duration_seconds" INTEGER;
    END IF;

    -- Add success_count_30d if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'success_count_30d'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "success_count_30d" INTEGER NOT NULL DEFAULT 0;
    END IF;

    -- Add failure_count_30d if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'failure_count_30d'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "failure_count_30d" INTEGER NOT NULL DEFAULT 0;
    END IF;

    -- Add timeout_count_30d if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'timeout_count_30d'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "timeout_count_30d" INTEGER NOT NULL DEFAULT 0;
    END IF;

    -- Add last_success_at if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'last_success_at'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "last_success_at" TIMESTAMPTZ(6);
    END IF;

    -- Add last_failure_at if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'last_failure_at'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "last_failure_at" TIMESTAMPTZ(6);
    END IF;

    -- Add last_timeout_at if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'last_timeout_at'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "last_timeout_at" TIMESTAMPTZ(6);
    END IF;

    -- Add performance_baseline_seconds if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'performance_baseline_seconds'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "performance_baseline_seconds" INTEGER;
    END IF;

    -- Add performance_degradation_alert_sent_at if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'performance_degradation_alert_sent_at'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "performance_degradation_alert_sent_at" TIMESTAMPTZ(6);
    END IF;

    -- Add alert_duration_threshold_seconds if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'alert_duration_threshold_seconds'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "alert_duration_threshold_seconds" INTEGER;
    END IF;

    -- Add alert_failure_rate_threshold if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'alert_failure_rate_threshold'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "alert_failure_rate_threshold" DECIMAL(5, 4);
    END IF;

    -- Add alert_connection_threshold if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'alert_connection_threshold'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "alert_connection_threshold" INTEGER;
    END IF;

    -- Add alert_enabled if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'CronJob' AND column_name = 'alert_enabled'
    ) THEN
        ALTER TABLE "CronJob" ADD COLUMN "alert_enabled" BOOLEAN NOT NULL DEFAULT true;
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Create CronJobExecution table
-- ============================================================================
-- OBSOLETE: CronJobExecution has been migrated to MongoDB.
-- This step is kept for historical reference only. If you need to clean up, use:
-- scripts/database/remove-cron-job-execution-from-postgres.sh
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'CronJobExecution') THEN
        CREATE TABLE "CronJobExecution" (
            "id" BIGSERIAL PRIMARY KEY,
            "job_id" INTEGER NOT NULL,
            "started_at" TIMESTAMPTZ(6) NOT NULL,
            "completed_at" TIMESTAMPTZ(6),
            "duration_seconds" INTEGER,
            "status" execution_status NOT NULL,
            "error_message" TEXT,
            "error_type" VARCHAR(100),
            "records_processed" INTEGER DEFAULT 0,
            "records_created" INTEGER DEFAULT 0,
            "records_updated" INTEGER DEFAULT 0,
            "records_deleted" INTEGER DEFAULT 0,
            "peak_connections" INTEGER,
            "timeout_period_seconds" INTEGER,
            "correlation_id" VARCHAR(255),
            "performance_metrics" JSONB,
            "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
            
            CONSTRAINT "CronJobExecution_job_id_fkey" 
                FOREIGN KEY ("job_id") 
                REFERENCES "CronJob"("id") 
                ON DELETE CASCADE
        );
    END IF;
END $$;

-- ============================================================================
-- STEP 4: Create indexes on CronJobExecution
-- ============================================================================
-- OBSOLETE: CronJobExecution has been migrated to MongoDB.
-- This step is kept for historical reference only. If you need to clean up, use:
-- scripts/database/remove-cron-job-execution-from-postgres.sh
-- ============================================================================
DO $$
BEGIN
    -- Index on job_id and started_at
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_cron_job_execution_job_started'
    ) THEN
        CREATE INDEX "idx_cron_job_execution_job_started" 
        ON "CronJobExecution"("job_id", "started_at");
    END IF;

    -- Index on status and started_at
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_cron_job_execution_status_started'
    ) THEN
        CREATE INDEX "idx_cron_job_execution_status_started" 
        ON "CronJobExecution"("status", "started_at");
    END IF;

    -- Index on started_at
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_cron_job_execution_started_at'
    ) THEN
        CREATE INDEX "idx_cron_job_execution_started_at" 
        ON "CronJobExecution"("started_at");
    END IF;

    -- Index on correlation_id
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_cron_job_execution_correlation'
    ) THEN
        CREATE INDEX "idx_cron_job_execution_correlation" 
        ON "CronJobExecution"("correlation_id");
    END IF;

    -- Index on status
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_cron_job_execution_status'
    ) THEN
        CREATE INDEX "idx_cron_job_execution_status" 
        ON "CronJobExecution"("status");
    END IF;
END $$;

-- ============================================================================
-- STEP 5: Create indexes on CronJob (if they don't exist)
-- ============================================================================
DO $$
BEGIN
    -- Index on last_run_at
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_cron_job_last_run_at'
    ) THEN
        CREATE INDEX "idx_cron_job_last_run_at" 
        ON "CronJob"("last_run_at");
    END IF;

    -- Index on active and next_run_at
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_cron_job_active_next_run'
    ) THEN
        CREATE INDEX "idx_cron_job_active_next_run" 
        ON "CronJob"("active", "next_run_at");
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After running this migration, verify with:
-- 
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'CronJob' 
-- AND column_name IN (
--     'last_execution_duration_seconds',
--     'average_execution_duration_seconds',
--     'success_count_30d',
--     'failure_count_30d',
--     'timeout_count_30d'
-- );
--
-- OBSOLETE: CronJobExecution table verification (migrated to MongoDB)
-- SELECT table_name 
-- FROM information_schema.tables 
-- WHERE table_name = 'CronJobExecution';
--
-- OBSOLETE: execution_status enum verification (migrated to MongoDB)
-- SELECT typname FROM pg_type WHERE typname = 'execution_status';

