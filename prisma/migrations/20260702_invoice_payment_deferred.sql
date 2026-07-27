-- Deferred payments: allow unlinked InvoicePayment rows awaiting invoice match.

ALTER TABLE "InvoicePayment"
ALTER COLUMN "invoice_id" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_invoice_payment_deferred_lookup"
ON "InvoicePayment" ("account_id", "customer_id", "invoice_number")
WHERE "invoice_id" IS NULL;
