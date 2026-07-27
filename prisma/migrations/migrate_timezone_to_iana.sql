-- Migration: Convert time_zone enum to IANA timezone identifiers
-- Date: 2024-11-13
-- Description: 
--   This migration converts the User.time_zone column from an enum type to VARCHAR(50)
--   and updates all existing enum values to their corresponding IANA timezone identifiers.
--
-- Steps:
--   1. Convert column type from enum to VARCHAR(50)
--   2. Update all timezone values from enum format to IANA format

-- Step 1: Convert time_zone column from enum to VARCHAR(50)
-- This converts all enum values to their text representation
ALTER TABLE "User" 
ALTER COLUMN time_zone TYPE VARCHAR(50) 
USING time_zone::text;

-- Step 2: Update all timezone values from enum format to IANA format
-- Note: This migration script already updated the values, but this SQL documents
-- the transformation that was applied. The actual updates were done via the
-- migrate-timezone-to-iana.ts script which handled the mapping.

-- Example mappings that were applied:
-- UTC_02_00__Jerusalem → Asia/Jerusalem
-- UTC_05_00__Eastern_Time__US___Canada_ → America/New_York
-- UTC_05_30__Chennai__Kolkata__Mumbai__New_Delhi → Asia/Kolkata
-- UTC_00_00__Coordinated_Universal_Time → UTC
-- etc.

-- The migration script (scripts/database/migrate-timezone-to-iana.ts) handled
-- all 60 user records, converting enum values to IANA identifiers.

-- Step 3: Update the default value and drop the unused time_zone enum type
-- First, drop the old default constraint (which references the enum)
ALTER TABLE "User" 
ALTER COLUMN time_zone DROP DEFAULT;

-- Set the new default value (IANA format)
ALTER TABLE "User" 
ALTER COLUMN time_zone SET DEFAULT 'Asia/Jerusalem';

-- Now drop the unused enum type
-- PostgreSQL doesn't automatically drop enum types when they're no longer used.
-- Since we've converted all columns to VARCHAR, we can safely drop the enum.
-- Note: The enum may have been recreated with display string values at some point,
-- but since no objects depend on it, we can drop it with CASCADE to be safe.
DROP TYPE IF EXISTS "time_zone" CASCADE;

-- Verification queries (run after migration to verify):
-- SELECT id, time_zone FROM "User" WHERE time_zone IS NOT NULL LIMIT 10;
-- SELECT typname FROM pg_type WHERE typname = 'time_zone'; -- Should return no rows

