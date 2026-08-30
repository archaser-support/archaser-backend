-- Customer: oldest overdue due date ignoring the MEP breach start-date gate (display only).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260830_customer_oldest_invoice_overdue_date_all.sql

BEGIN;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "oldest_invoice_overdue_date_all" TIMESTAMP(6);

COMMIT;
