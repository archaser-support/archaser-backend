-- ============================================================================
-- Consolidated Database Migration Script
-- Source: feature/ui-changes branch (all DB changes vs main)
-- Generated: 2025-02-05
--
-- This script consolidates all database migrations from the feature/ui-changes
-- branch into a single executable script. Run in order; each section is
-- idempotent where possible.
--
-- IMPORTANT: Execute manually (e.g. DBeaver). After running: npx prisma generate
--
-- NOTE: Branch "feature/statistic-migration" was not found. This script was
-- generated from "feature/ui-changes" which contains the database changes.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: Account - Theme Colors
-- ============================================================================
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "primary_color" VARCHAR(7);
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "secondary_color" VARCHAR(7);
COMMENT ON COLUMN "Account"."primary_color" IS 'Custom primary color in hex format (#RRGGBB). Null uses default theme color.';
COMMENT ON COLUMN "Account"."secondary_color" IS 'Custom secondary color in hex format (#RRGGBB). Null uses default theme color.';

-- ============================================================================
-- SECTION 2: Report Builder Tables
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

-- Report FKs
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_account_id_fkey') THEN
        ALTER TABLE "Report" ADD CONSTRAINT "Report_account_id_fkey"
            FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_created_by_fkey') THEN
        ALTER TABLE "Report" ADD CONSTRAINT "Report_created_by_fkey"
            FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_modified_by_fkey') THEN
        ALTER TABLE "Report" ADD CONSTRAINT "Report_modified_by_fkey"
            FOREIGN KEY ("modified_by") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

-- ReportShare FKs
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportShare_report_id_fkey') THEN
        ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_report_id_fkey"
            FOREIGN KEY ("report_id") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportShare_shared_with_user_id_fkey') THEN
        ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_shared_with_user_id_fkey"
            FOREIGN KEY ("shared_with_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportShare_created_by_fkey') THEN
        ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_created_by_fkey"
            FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

-- ReportSchedule FK
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportSchedule_report_id_fkey') THEN
        ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_report_id_fkey"
            FOREIGN KEY ("report_id") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

-- ReportExecution FKs
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportExecution_report_id_fkey') THEN
        ALTER TABLE "ReportExecution" ADD CONSTRAINT "ReportExecution_report_id_fkey"
            FOREIGN KEY ("report_id") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportExecution_executed_by_fkey') THEN
        ALTER TABLE "ReportExecution" ADD CONSTRAINT "ReportExecution_executed_by_fkey"
            FOREIGN KEY ("executed_by") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

-- Report indexes
CREATE INDEX IF NOT EXISTS "idx_report_account_id" ON "Report"("account_id");
CREATE INDEX IF NOT EXISTS "idx_report_created_by" ON "Report"("created_by");
CREATE INDEX IF NOT EXISTS "idx_report_modified_by" ON "Report"("modified_by");
CREATE INDEX IF NOT EXISTS "idx_report_is_public" ON "Report"("is_public");
CREATE INDEX IF NOT EXISTS "idx_report_share_report_id" ON "ReportShare"("report_id");
CREATE INDEX IF NOT EXISTS "idx_report_share_user_id" ON "ReportShare"("shared_with_user_id");
CREATE INDEX IF NOT EXISTS "idx_report_share_role" ON "ReportShare"("shared_with_role");
CREATE INDEX IF NOT EXISTS "idx_report_schedule_report_id" ON "ReportSchedule"("report_id");
CREATE INDEX IF NOT EXISTS "idx_report_schedule_is_active" ON "ReportSchedule"("is_active");
CREATE INDEX IF NOT EXISTS "idx_report_schedule_next_run_at" ON "ReportSchedule"("next_run_at");
CREATE INDEX IF NOT EXISTS "idx_report_execution_report_id" ON "ReportExecution"("report_id");
CREATE INDEX IF NOT EXISTS "idx_report_execution_executed_by" ON "ReportExecution"("executed_by");
CREATE INDEX IF NOT EXISTS "idx_report_execution_executed_at" ON "ReportExecution"("executed_at");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_report_share_user') THEN
        ALTER TABLE "ReportShare" ADD CONSTRAINT "unique_report_share_user" UNIQUE ("report_id", "shared_with_user_id");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_report_share_role') THEN
        ALTER TABLE "ReportShare" ADD CONSTRAINT "unique_report_share_role" UNIQUE ("report_id", "shared_with_role");
    END IF;
END $$;

-- ============================================================================
-- SECTION 3: Report - is_system, context, is_default
-- ============================================================================
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "context" VARCHAR(50);
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "idx_report_is_system" ON "Report"("is_system");
CREATE INDEX IF NOT EXISTS "idx_report_context" ON "Report"("context");
CREATE INDEX IF NOT EXISTS "idx_report_system_context" ON "Report"("is_system", "context");
CREATE INDEX IF NOT EXISTS "idx_report_default_context" ON "Report"("is_default", "context");

UPDATE "Report" SET "is_default" = true
WHERE "is_system" = true AND "context" = 'customers' AND "name" = 'All Customers' AND "is_default" = false;

-- ============================================================================
-- SECTION 4: Report - unique_name
-- ============================================================================
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "unique_name" VARCHAR(255);

DO $$
DECLARE
    rec RECORD;
    clean_name TEXT;
    candidate_name TEXT;
    counter INTEGER;
BEGIN
    FOR rec IN SELECT id, name, account_id FROM "Report" WHERE "unique_name" IS NULL OR TRIM("unique_name") = ''
    LOOP
        clean_name := lower(regexp_replace(COALESCE(rec.name, ''), '[^a-z0-9]+', '_', 'g'));
        clean_name := trim(both '_' from clean_name);
        IF clean_name = '' OR clean_name IS NULL THEN clean_name := 'report'; END IF;
        candidate_name := clean_name;
        counter := 0;
        WHILE EXISTS (SELECT 1 FROM "Report" r WHERE r.account_id = rec.account_id AND r.unique_name = candidate_name AND r.id != rec.id) LOOP
            counter := counter + 1;
            candidate_name := clean_name || '_' || counter;
        END LOOP;
        UPDATE "Report" SET unique_name = candidate_name WHERE id = rec.id;
    END LOOP;
END $$;

UPDATE "Report" SET "unique_name" = 'report_' || id::TEXT WHERE "unique_name" IS NULL OR TRIM("unique_name") = '';

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Report' AND column_name = 'unique_name' AND is_nullable = 'YES') THEN
        ALTER TABLE "Report" ALTER COLUMN "unique_name" SET NOT NULL;
    END IF;
END $$;

DROP INDEX IF EXISTS "idx_report_account_unique_name";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_report_account_unique_name" ON "Report"("account_id", "unique_name");

-- ============================================================================
-- SECTION 5: UserDefaultReport Table
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

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserDefaultReport_user_id_fkey') THEN
        ALTER TABLE "UserDefaultReport" ADD CONSTRAINT "UserDefaultReport_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserDefaultReport_report_id_fkey') THEN
        ALTER TABLE "UserDefaultReport" ADD CONSTRAINT "UserDefaultReport_report_id_fkey"
            FOREIGN KEY ("report_id") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_default_report') THEN
        ALTER TABLE "UserDefaultReport" ADD CONSTRAINT "unique_user_default_report" UNIQUE ("user_id", "context");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_user_default_report_user_id" ON "UserDefaultReport"("user_id");
CREATE INDEX IF NOT EXISTS "idx_user_default_report_context" ON "UserDefaultReport"("context");
CREATE INDEX IF NOT EXISTS "idx_user_default_report_user_context" ON "UserDefaultReport"("user_id", "context");
CREATE INDEX IF NOT EXISTS "idx_user_default_report_report_id" ON "UserDefaultReport"("report_id");

-- ============================================================================
-- SECTION 6: User - username field
-- ============================================================================
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" VARCHAR(255);
UPDATE "User" SET "username" = "email" WHERE "username" IS NULL AND "email" IS NOT NULL;
UPDATE "User" SET "username" = "id" WHERE "username" IS NULL;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'username' AND is_nullable = 'YES') THEN
        ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
DROP INDEX IF EXISTS "User_email_key";

-- ============================================================================
-- SECTION 7: User - is_audit_user
-- ============================================================================
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "is_audit_user" BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- SECTION 8: Contact - full_name
-- ============================================================================
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "full_name" VARCHAR;

-- ============================================================================
-- SECTION 9: CustomerDispute - closed_at
-- ============================================================================
ALTER TABLE "CustomerDispute" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMPTZ(6);

-- ============================================================================
-- SECTION 10: BusinessUnitBankAccounts Table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'BusinessUnitBankAccounts') THEN
        CREATE TABLE "BusinessUnitBankAccounts" (
            id SERIAL PRIMARY KEY,
            business_unit_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL,
            bank_account_id INTEGER NOT NULL,
            created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
            modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
            created_by VARCHAR,
            modified_by VARCHAR,
            CONSTRAINT "BusinessUnitBankAccounts_business_unit_id_fkey" FOREIGN KEY (business_unit_id) REFERENCES "BusinessUnit"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
            CONSTRAINT "BusinessUnitBankAccounts_account_id_fkey" FOREIGN KEY (account_id) REFERENCES "Account"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
            CONSTRAINT "BusinessUnitBankAccounts_bank_account_id_fkey" FOREIGN KEY (bank_account_id) REFERENCES "AccountBankAccounts"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
            CONSTRAINT "unique_business_unit_bank_account" UNIQUE (business_unit_id, bank_account_id)
        );
        CREATE INDEX "idx_business_unit_bank_accounts_bu" ON "BusinessUnitBankAccounts"(business_unit_id);
        CREATE INDEX "idx_business_unit_bank_accounts_account" ON "BusinessUnitBankAccounts"(account_id);
        CREATE INDEX "idx_business_unit_bank_accounts_bank" ON "BusinessUnitBankAccounts"(bank_account_id);
    END IF;
END $$;

-- ============================================================================
-- SECTION 11: Due Notification Support
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE "step_type" AS ENUM ('due', 'overdue');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ActivitiesSequence" ADD COLUMN IF NOT EXISTS "step_type" "step_type" DEFAULT 'overdue';
ALTER TABLE "ActivitiesSequence" ADD COLUMN IF NOT EXISTS "days_before_due" INTEGER;
UPDATE "ActivitiesSequence" SET step_type = 'overdue' WHERE step_type IS NULL;

ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "invoice_id" INTEGER;
DO $$ BEGIN
    ALTER TABLE "Activity" ADD CONSTRAINT "Activity_invoice_id_fkey"
        FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Activity" ALTER COLUMN "collection_period_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_activity_invoice_sequence" ON "Activity"("invoice_id", "activity_sequence_id");

INSERT INTO "CronJob" (name, cron_expression, active, sort_order, timeout_period_seconds, created_at, modified_at)
SELECT 'Due Invoice Notifications', '0 6 * * *', true, 2, 1800, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "CronJob" WHERE name = 'Due Invoice Notifications');

COMMIT;

-- ============================================================================
-- Post-migration: Run npx prisma generate
-- ============================================================================
