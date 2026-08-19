-- Drop unique constraint/index on (account_id, customer_id, reference) on InvoicePayment
-- to allow multiple payments (e.g. against different invoices) sharing the same reference number.

DROP INDEX IF EXISTS "idx_unique_customer_reference";
ALTER TABLE "InvoicePayment" DROP CONSTRAINT IF EXISTS "idx_unique_customer_reference";

CREATE INDEX IF NOT EXISTS "idx_invoice_payment_customer_reference"
ON "InvoicePayment" ("account_id", "customer_id", "reference");

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "priority_erp_debit" VARCHAR(10);
