-- Migration: Create BusinessUnit Table
-- This script creates the BusinessUnit table with all fields, indexes, and constraints.
--
-- IMPORTANT: Execute this script manually on your database before running data update scripts.
-- This migration uses transactions - if any step fails, the entire migration will rollback.
--
-- Execution order:
-- 1. User executes this SQL script manually
-- 2. Run the TypeScript data update script: npx ts-node scripts/update-business-units-data.ts

BEGIN;

-- ============================================================================
-- STEP 1: Create BusinessUnit Table
-- ============================================================================
-- Create the table only if it doesn't exist (idempotent)

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'BusinessUnit') THEN
        CREATE TABLE "BusinessUnit" (
            id SERIAL PRIMARY KEY,
            account_id INTEGER NOT NULL,
            name VARCHAR NOT NULL,
            parent_id INTEGER,
            external_id VARCHAR,
            status record_status NOT NULL DEFAULT 'Active',
            is_primary BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
            modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
            created_by VARCHAR,
            modified_by VARCHAR,
            
            -- Foreign key constraints
            CONSTRAINT "BusinessUnit_account_id_fkey" 
                FOREIGN KEY (account_id) 
                REFERENCES "Account"(id) 
                ON DELETE CASCADE 
                ON UPDATE NO ACTION,
            
            CONSTRAINT "BusinessUnit_parent_id_fkey" 
                FOREIGN KEY (parent_id) 
                REFERENCES "BusinessUnit"(id) 
                ON DELETE NO ACTION 
                ON UPDATE NO ACTION,
            
            CONSTRAINT "BusinessUnit_created_by_fkey" 
                FOREIGN KEY (created_by) 
                REFERENCES "User"(id) 
                ON DELETE NO ACTION 
                ON UPDATE NO ACTION,
            
            CONSTRAINT "BusinessUnit_modified_by_fkey" 
                FOREIGN KEY (modified_by) 
                REFERENCES "User"(id) 
                ON DELETE NO ACTION 
                ON UPDATE NO ACTION
        );

        -- Create indexes
        CREATE INDEX "idx_business_unit_account_id" ON "BusinessUnit"(account_id);
        CREATE INDEX "idx_business_unit_parent_id" ON "BusinessUnit"(parent_id);
        CREATE INDEX "idx_business_unit_external_id" ON "BusinessUnit"(external_id);
        CREATE INDEX "idx_business_unit_status" ON "BusinessUnit"(status);
        CREATE INDEX "idx_business_unit_is_primary" ON "BusinessUnit"(is_primary);
        CREATE INDEX "idx_business_unit_created_by" ON "BusinessUnit"(created_by);
        CREATE INDEX "idx_business_unit_modified_by" ON "BusinessUnit"(modified_by);

        -- Add comment to table
        COMMENT ON TABLE "BusinessUnit" IS 'Business units for organizational hierarchy and access control';

        RAISE NOTICE 'BusinessUnit table created successfully';
    ELSE
        RAISE NOTICE 'BusinessUnit table already exists, skipping creation';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Ensure business_unit_id columns exist in Customer and User tables
-- ============================================================================

-- Add business_unit_id to Customer table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Customer' AND column_name = 'business_unit_id'
    ) THEN
        ALTER TABLE "Customer" ADD COLUMN business_unit_id INTEGER;
        
        -- Add foreign key constraint
        ALTER TABLE "Customer" 
            ADD CONSTRAINT "Customer_business_unit_id_fkey" 
            FOREIGN KEY (business_unit_id) 
            REFERENCES "BusinessUnit"(id) 
            ON DELETE NO ACTION 
            ON UPDATE NO ACTION;
        
        -- Create index
        CREATE INDEX "idx_customer_business_unit_id" ON "Customer"(business_unit_id);
        
        RAISE NOTICE 'Added business_unit_id column to Customer table';
    ELSE
        RAISE NOTICE 'business_unit_id column already exists in Customer table';
    END IF;
END $$;

-- Add business_unit_id to User table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'User' AND column_name = 'business_unit_id'
    ) THEN
        ALTER TABLE "User" ADD COLUMN business_unit_id INTEGER;
        
        -- Add foreign key constraint
        ALTER TABLE "User" 
            ADD CONSTRAINT "User_business_unit_id_fkey" 
            FOREIGN KEY (business_unit_id) 
            REFERENCES "BusinessUnit"(id) 
            ON DELETE NO ACTION 
            ON UPDATE NO ACTION;
        
        -- Create index
        CREATE INDEX "idx_user_business_unit_id" ON "User"(business_unit_id);
        
        RAISE NOTICE 'Added business_unit_id column to User table';
    ELSE
        RAISE NOTICE 'business_unit_id column already exists in User table';
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
    -- Verify BusinessUnit table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'BusinessUnit') THEN
        RAISE NOTICE '✓ BusinessUnit table verified';
    ELSE
        RAISE EXCEPTION 'BusinessUnit table was not created';
    END IF;
    
    -- Verify Customer has business_unit_id column
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Customer' AND column_name = 'business_unit_id'
    ) THEN
        RAISE NOTICE '✓ Customer.business_unit_id column verified';
    ELSE
        RAISE EXCEPTION 'Customer.business_unit_id column was not created';
    END IF;
    
    -- Verify User has business_unit_id column
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'User' AND column_name = 'business_unit_id'
    ) THEN
        RAISE NOTICE '✓ User.business_unit_id column verified';
    ELSE
        RAISE EXCEPTION 'User.business_unit_id column was not created';
    END IF;
END $$;

