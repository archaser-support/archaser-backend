-- Calendar-date semantics: oldest overdue due dates are derived from Invoice.due_date (@db.Date).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260902_customer_oldest_invoice_overdue_date_to_date.sql

ALTER TABLE "Customer"
  ALTER COLUMN "oldest_invoice_overdue_date"
    TYPE DATE
    USING "oldest_invoice_overdue_date"::date;

ALTER TABLE "Customer"
  ALTER COLUMN "oldest_invoice_overdue_date_all"
    TYPE DATE
    USING "oldest_invoice_overdue_date_all"::date;
