-- Invoice: oldest_overdue_invoice_date
-- Stores the oldest overdue invoice due date for the invoice's customer
-- at the time invoice import processing runs.

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "oldest_overdue_invoice_date" DATE;
