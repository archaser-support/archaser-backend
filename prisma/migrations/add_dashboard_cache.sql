-- Migration: Create DashboardCache Table
-- This script creates the DashboardCache table for pre-calculated dashboard metrics.
--
-- IMPORTANT: Execute this script manually on your database before using the dashboard cache feature.
-- This migration uses transactions - if any step fails, the entire migration will rollback.
--
-- Execution order:
-- 1. User executes this SQL script manually (or via run-dashboard-cache-migration.sh)
-- 2. Run: npx prisma generate

BEGIN;

-- ============================================================================
-- STEP 1: Create DashboardCache Table
-- ============================================================================
-- Create the table only if it doesn't exist (idempotent)

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'DashboardCache') THEN
        CREATE TABLE "DashboardCache" (
            id SERIAL PRIMARY KEY,
            account_id INTEGER NOT NULL,
            business_unit_id INTEGER,
            owner_id VARCHAR,
            view_mode VARCHAR(10) NOT NULL, -- "child" | "parent"
            cache_key VARCHAR(255) NOT NULL UNIQUE,
            
            -- Scalar metrics
            active_customers INTEGER NOT NULL DEFAULT 0,
            overdue_amount REAL NOT NULL DEFAULT 0,
            overdue_invoices INTEGER NOT NULL DEFAULT 0,
            total_collected REAL NOT NULL DEFAULT 0,
            total_due REAL NOT NULL DEFAULT 0,
            due_today REAL NOT NULL DEFAULT 0,
            due_this_week REAL NOT NULL DEFAULT 0,
            due_this_month REAL NOT NULL DEFAULT 0,
            due_next_month REAL NOT NULL DEFAULT 0,
            
            -- JSON fields for complex data structures
            collection_stats JSONB,
            category_stats JSONB,
            dispute_stats JSONB,
            chart_data JSONB, -- All chart series data
            aging_portfolio JSONB,
            receivables_schedule JSONB,
            invoices_by_customer JSONB,
            invoices_by_business_unit JSONB,
            overdue_invoices_by_customer JSONB,
            overdue_invoices_by_business_unit JSONB,
            
            -- Metadata
            last_calculated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ(6) NOT NULL,
            created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
            modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
        );

        -- Create indexes
        CREATE INDEX "idx_dashboard_cache_lookup" ON "DashboardCache"(account_id, business_unit_id, owner_id, view_mode);
        CREATE INDEX "idx_dashboard_cache_expires" ON "DashboardCache"(expires_at);
        CREATE INDEX "idx_dashboard_cache_key" ON "DashboardCache"(cache_key);
        CREATE INDEX "idx_dashboard_cache_account" ON "DashboardCache"(account_id);

        -- Add comment to table
        COMMENT ON TABLE "DashboardCache" IS 'Pre-calculated dashboard metrics cache to reduce database load';

        RAISE NOTICE 'DashboardCache table created successfully';
    ELSE
        RAISE NOTICE 'DashboardCache table already exists, skipping creation';
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
    -- Verify DashboardCache table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'DashboardCache') THEN
        RAISE NOTICE '✓ DashboardCache table verified';
    ELSE
        RAISE EXCEPTION 'DashboardCache table was not created';
    END IF;
    
    -- Verify indexes exist
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'DashboardCache' AND indexname = 'idx_dashboard_cache_lookup'
    ) THEN
        RAISE NOTICE '✓ DashboardCache indexes verified';
    ELSE
        RAISE EXCEPTION 'DashboardCache indexes were not created';
    END IF;
END $$;

