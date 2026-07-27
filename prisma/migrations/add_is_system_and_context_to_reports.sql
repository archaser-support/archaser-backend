-- Migration: Add is_system and context fields to Report table
-- This script adds support for system reports that are copied to all accounts
--
-- IMPORTANT: Execute this script manually on your database.
-- After running, regenerate Prisma client: npx prisma generate

BEGIN;

-- Add is_system column
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false;

-- Add context column
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "context" VARCHAR(50);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_report_is_system" ON "Report"("is_system");
CREATE INDEX IF NOT EXISTS "idx_report_context" ON "Report"("context");
CREATE INDEX IF NOT EXISTS "idx_report_system_context" ON "Report"("is_system", "context");

COMMIT;
