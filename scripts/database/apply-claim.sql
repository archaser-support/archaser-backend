-- ============================================================================
-- Add Claim table + claim_status enum for credit-insurance claims tracking.
-- Idempotent. Safe to re-run. Additive only (no drops / data rewrites).
--
-- Matches prisma/schema.prisma:
--   enum claim_status
--   model Claim
--
-- Run (from backend repo root, against the target DB):
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/database/apply-claim.sql
--
-- Or: npx prisma db push (local/dev per project rules — not migrate dev / force-reset)
--
-- No BEGIN/COMMIT: prisma db execute (and many clients) already wrap
-- the file in a transaction; nested BEGIN causes
-- "there is already a transaction in progress".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Enum: claim_status
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'claim_status'
          AND n.nspname = 'public'
    ) THEN
        CREATE TYPE "claim_status" AS ENUM (
            'Draft',
            'Submitted',
            'Under Inquiry',
            'Approved',
            'Paid',
            'Rejected',
            'Canceled'
        );
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Claim table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Claim" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" INTEGER NOT NULL,
    "insurance_policy_id" INTEGER NOT NULL,
    "invoice_id" INTEGER,
    "customer_id" INTEGER NOT NULL,
    "status" "claim_status" NOT NULL DEFAULT 'Draft',
    "recognized_loss" DECIMAL(20, 4) NOT NULL,
    "loss_date" DATE,
    "policy_year" INTEGER NOT NULL,
    "submission_date" DATE,
    "insurer_submission_reference" VARCHAR(255),
    "applied_sdl_excess" DECIMAL(20, 4),
    "applied_aggregate_excess" DECIMAL(20, 4),
    "excess_applied" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_by" VARCHAR,
    "modified_by" VARCHAR,
    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3) Indexes / unique
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "unique_claim_invoice_id"
    ON "Claim" ("invoice_id");

CREATE INDEX IF NOT EXISTS "idx_claim_account_id"
    ON "Claim" ("account_id");

CREATE INDEX IF NOT EXISTS "idx_claim_policy_year"
    ON "Claim" ("insurance_policy_id", "policy_year");

CREATE INDEX IF NOT EXISTS "idx_claim_account_status"
    ON "Claim" ("account_id", "status");

CREATE INDEX IF NOT EXISTS "idx_claim_customer_id"
    ON "Claim" ("customer_id");

CREATE INDEX IF NOT EXISTS "idx_claim_created_by"
    ON "Claim" ("created_by");

CREATE INDEX IF NOT EXISTS "idx_claim_modified_by"
    ON "Claim" ("modified_by");

-- ---------------------------------------------------------------------------
-- 4) Foreign keys (idempotent via catalog check)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'claim_account_id_fkey'
    ) THEN
        ALTER TABLE "Claim"
            ADD CONSTRAINT "claim_account_id_fkey"
            FOREIGN KEY ("account_id") REFERENCES "Account"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'claim_insurance_policy_id_fkey'
    ) THEN
        ALTER TABLE "Claim"
            ADD CONSTRAINT "claim_insurance_policy_id_fkey"
            FOREIGN KEY ("insurance_policy_id") REFERENCES "InsurancePolicy"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'claim_invoice_id_fkey'
    ) THEN
        ALTER TABLE "Claim"
            ADD CONSTRAINT "claim_invoice_id_fkey"
            FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'claim_customer_id_fkey'
    ) THEN
        ALTER TABLE "Claim"
            ADD CONSTRAINT "claim_customer_id_fkey"
            FOREIGN KEY ("customer_id") REFERENCES "Customer"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ClaimCreatedBy_fkey'
    ) THEN
        ALTER TABLE "Claim"
            ADD CONSTRAINT "ClaimCreatedBy_fkey"
            FOREIGN KEY ("created_by") REFERENCES "User"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ClaimModifiedBy_fkey'
    ) THEN
        ALTER TABLE "Claim"
            ADD CONSTRAINT "ClaimModifiedBy_fkey"
            FOREIGN KEY ("modified_by") REFERENCES "User"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END
$$;

-- Ensure customer_id is required (tables created before this rule may still be nullable).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Claim'
          AND column_name = 'customer_id'
          AND is_nullable = 'YES'
    ) AND NOT EXISTS (
        SELECT 1 FROM "Claim" WHERE "customer_id" IS NULL
    ) THEN
        ALTER TABLE "Claim" ALTER COLUMN "customer_id" SET NOT NULL;
    END IF;
END
$$;
