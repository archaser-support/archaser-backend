-- Billing connector import-cache / sync calendar timezone (IANA).
ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "time_zone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Jerusalem';
