-- Calendar-date semantics: payment_date is ERP/business day only (UTC cast).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260903_invoice_payment_payment_date_to_date.sql

ALTER TABLE "InvoicePayment"
  ALTER COLUMN "payment_date"
    TYPE DATE
    USING "payment_date"::date;
