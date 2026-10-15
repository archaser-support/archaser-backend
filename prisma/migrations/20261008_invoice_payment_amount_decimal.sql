-- InvoicePayment amounts: real (float32) → numeric(20,4).
-- Fixes recon virtual close / as-of open AR leftover drift (float32 vs JS sum).
-- Apply: npx prisma db execute --file prisma/migrations/20261008_invoice_payment_amount_decimal.sql

-- real::numeric keeps only 6 significant digits (117182.4 → 117182); go through
-- double precision first so the stored float32 value survives intact.

ALTER TABLE "InvoicePayment"
    ALTER COLUMN "amount" TYPE NUMERIC(20, 4)
        USING ROUND(("amount")::double precision::numeric, 2),
    ALTER COLUMN "customer_amount" TYPE NUMERIC(20, 4)
        USING ROUND(("customer_amount")::double precision::numeric, 2);
