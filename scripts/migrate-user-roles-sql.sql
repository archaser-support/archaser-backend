-- Migration script to update user_role enum and migrate existing data
-- This script:
-- 1. Adds new enum values (archaser_admin, Collection_Manager, System_Administrator)
-- 2. Migrates existing Admin -> archaser_admin
-- 3. Migrates existing Account_Manager -> Collection_Manager
-- 4. Removes old enum values (Admin, Account_Manager)

BEGIN;

-- Step 1: Add new enum values to the existing enum type
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'archaser_admin';
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'Collection_Manager';
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'System_Administrator';

-- Step 2: Migrate Admin -> archaser_admin
UPDATE "User" 
SET role = 'archaser_admin' 
WHERE role = 'Admin';

-- Step 3: Migrate Account_Manager -> Collection_Manager
UPDATE "User" 
SET role = 'Collection_Manager' 
WHERE role = 'Account Manager';

-- Note: We cannot directly remove enum values in PostgreSQL.
-- The old enum values (Admin, Account_Manager) will remain in the enum type
-- but won't be used. To fully remove them, you would need to:
-- 1. Create a new enum without the old values
-- 2. Alter the table to use the new enum
-- 3. Drop the old enum
-- This is more complex and usually not necessary as unused enum values don't cause issues.

COMMIT;

