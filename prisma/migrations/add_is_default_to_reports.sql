-- Migration: Add is_default field to Report table
-- This script adds support for default views that are auto-selected on page load
--
-- IMPORTANT: Execute this script manually on your database.
-- After running, regenerate Prisma client: npx prisma generate

BEGIN;

-- Add is_default column
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;

-- Create index for efficient querying of default views by context
CREATE INDEX IF NOT EXISTS "idx_report_default_context" ON "Report"("is_default", "context");

-- Update existing "All Customers" system report to be default (if it exists)
UPDATE "Report"
SET "is_default" = true
WHERE "is_system" = true
  AND "context" = 'customers'
  AND "name" = 'All Customers'
  AND "is_default" = false;

COMMIT;

