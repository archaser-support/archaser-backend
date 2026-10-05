-- Oldest overdue invoice number that set customer MEP on this invoice's issue date.
-- Used only in the created-in-MEP terms-breach description.
-- Apply: npx prisma db execute --file prisma/migrations/20261005_invoice_ctv_mep_cause_invoice_number.sql

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "ctv_customer_overdue_mep_cause_invoice_number" VARCHAR(100);
