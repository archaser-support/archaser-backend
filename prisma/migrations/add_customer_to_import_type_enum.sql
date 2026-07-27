-- Migration: Add Customer to ImportType enum
-- This adds the "Customer" value to the ImportType enum if it doesn't exist

-- Check if Customer value exists, if not add it
DO $$
BEGIN
    -- Check if 'Customer' already exists in the enum
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        WHERE enumlabel = 'Customer' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ImportType')
    ) THEN
        -- Add 'Customer' to the ImportType enum
        ALTER TYPE "ImportType" ADD VALUE 'Customer';
    END IF;
END $$;

