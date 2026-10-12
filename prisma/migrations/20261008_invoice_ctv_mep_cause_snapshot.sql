-- Frozen snapshot of the MEP cause invoice on this invoice's issue date
-- (next to ctv_customer_overdue_mep_cause_invoice_number). Breach tooltip only.
-- Apply: npx prisma db execute --file prisma/migrations/20261008_invoice_ctv_mep_cause_snapshot.sql

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "ctv_customer_overdue_mep_cause_due_date" DATE,
ADD COLUMN IF NOT EXISTS "ctv_customer_overdue_mep_cause_outstanding" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "ctv_customer_overdue_mep_days_past" INTEGER;
