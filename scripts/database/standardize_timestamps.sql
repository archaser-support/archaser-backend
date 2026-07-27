-- SQL script to standardize timestamp fields across all tables
-- This script renames:
--   - updated_at -> modified_at
--   - updatedAt -> modified_at
--   - createdAt -> created_at
-- It uses idempotent logic to ensure it can be run multiple times.

BEGIN;

DO $$
DECLARE
    r RECORD;
BEGIN
    -- 1. Rename updated_at to modified_at (if modified_at doesn't exist)
    FOR r IN (
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'updated_at'
          AND table_name NOT IN (
              SELECT table_name 
              FROM information_schema.columns 
              WHERE column_name = 'modified_at' 
                AND table_schema = 'public'
          )
    ) LOOP
        EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO modified_at', r.table_name, r.column_name);
        RAISE NOTICE 'Renamed updated_at to modified_at in table %', r.table_name;
    END LOOP;

    -- 2. Rename updatedAt to modified_at (if modified_at doesn't exist)
    FOR r IN (
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'updatedAt'
          AND table_name NOT IN (
              SELECT table_name 
              FROM information_schema.columns 
              WHERE column_name = 'modified_at' 
                AND table_schema = 'public'
          )
    ) LOOP
        EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO modified_at', r.table_name, r.column_name);
        RAISE NOTICE 'Renamed updatedAt to modified_at in table %', r.table_name;
    END LOOP;

    -- 3. Rename createdAt to created_at (if created_at doesn't exist)
    FOR r IN (
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'createdAt'
          AND table_name NOT IN (
              SELECT table_name 
              FROM information_schema.columns 
              WHERE column_name = 'created_at' 
                AND table_schema = 'public'
          )
    ) LOOP
        EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO created_at', r.table_name, r.column_name);
        RAISE NOTICE 'Renamed createdAt to created_at in table %', r.table_name;
    END LOOP;

END $$;

COMMIT;
