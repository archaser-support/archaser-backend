-- ============================================================================
-- Migration Script: Add BusinessUnitBankAccounts Table
-- Generated: 2025-02-03
-- Context: Connect bank accounts to business units (BU can have one or more banks)
-- ============================================================================
--
-- Creates the BusinessUnitBankAccounts junction table linking BusinessUnit to
-- AccountBankAccounts. Used for:
-- - BU modal: add/remove bank accounts per business unit
-- - Pay Now portal: show BU banks + customer banks (merged, deduplicated)
--
-- IMPORTANT NOTES:
-- 1. Execute this script manually on the database (e.g. DBeaver)
-- 2. Run ROLLBACK; if you see "current transaction is aborted" errors
-- 3. After running, regenerate Prisma client: npx prisma generate
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create BusinessUnitBankAccounts Table
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

            CONSTRAINT "BusinessUnitBankAccounts_business_unit_id_fkey"
                FOREIGN KEY (business_unit_id)
                REFERENCES "BusinessUnit"(id)
                ON DELETE CASCADE
                ON UPDATE NO ACTION,

            CONSTRAINT "BusinessUnitBankAccounts_account_id_fkey"
                FOREIGN KEY (account_id)
                REFERENCES "Account"(id)
                ON DELETE CASCADE
                ON UPDATE NO ACTION,

            CONSTRAINT "BusinessUnitBankAccounts_bank_account_id_fkey"
                FOREIGN KEY (bank_account_id)
                REFERENCES "AccountBankAccounts"(id)
                ON DELETE CASCADE
                ON UPDATE NO ACTION,

            CONSTRAINT "unique_business_unit_bank_account"
                UNIQUE (business_unit_id, bank_account_id)
        );

        CREATE INDEX "idx_business_unit_bank_accounts_bu" ON "BusinessUnitBankAccounts"(business_unit_id);
        CREATE INDEX "idx_business_unit_bank_accounts_account" ON "BusinessUnitBankAccounts"(account_id);
        CREATE INDEX "idx_business_unit_bank_accounts_bank" ON "BusinessUnitBankAccounts"(bank_account_id);

        COMMENT ON TABLE "BusinessUnitBankAccounts" IS 'Junction table linking business units to bank accounts';

        RAISE NOTICE 'BusinessUnitBankAccounts table created successfully';
    ELSE
        RAISE NOTICE 'BusinessUnitBankAccounts table already exists, skipping creation';
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verification queries:
--
-- SELECT * FROM "BusinessUnitBankAccounts" LIMIT 5;
-- ============================================================================
