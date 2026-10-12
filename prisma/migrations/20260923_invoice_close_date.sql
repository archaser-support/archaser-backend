-- Add Invoice.close_date (calendar day invoice became Paid).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260923_invoice_close_date.sql

BEGIN;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "close_date" DATE;

CREATE INDEX IF NOT EXISTS "idx_invoice_account_close_date"
  ON "Invoice" ("account_id", "close_date");

COMMIT;
