-- Add zero-limit alert fields for customer policy, invoice, and customer rollups.
-- Run manually, then regenerate Prisma client with: npx prisma generate

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "zero_limit_alert" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CustomerPolicy"
  ADD COLUMN IF NOT EXISTS "zero_limit_date" DATE;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "zero_limit_alert_exist" BOOLEAN NOT NULL DEFAULT false;
