-- Add Policy to ImportType enum for CustomerPolicy bulk import jobs.
-- Run: psql "$DATABASE_URL" -f prisma/migrations/20260626_import_type_policy.sql

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumlabel = 'Policy'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ImportType')
    ) THEN
        ALTER TYPE "ImportType" ADD VALUE 'Policy';
    END IF;
END $$;
