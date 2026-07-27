-- Add Draft to shared record_status enum and set InsurancePolicy default status.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'record_status'
          AND e.enumlabel = 'Draft'
    ) THEN
        ALTER TYPE "record_status" ADD VALUE 'Draft';
    END IF;
END
$$;

ALTER TABLE "InsurancePolicy"
    ALTER COLUMN "status" SET DEFAULT 'Draft';
