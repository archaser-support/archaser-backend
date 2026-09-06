-- Billing connector: leftover band for Paid (customer outstanding, default 0.20).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260830_billing_connector_invoice_paid_tolerance.sql

BEGIN;

ALTER TABLE "BillingConnector"
  ADD COLUMN IF NOT EXISTS "invoice_paid_tolerance" DOUBLE PRECISION NOT NULL DEFAULT 0.2;

COMMIT;
