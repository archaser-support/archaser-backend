-- Follow-up to 20261008_invoice_payment_amount_decimal.sql.
-- real::numeric keeps only 6 significant digits (117182.4 → 117182); go through
-- double precision first so float32 bit patterns survive. Safe when columns are
-- already NUMERIC(20, 4) — rewrites values with the improved cast path.

ALTER TABLE "InvoicePayment"
    ALTER COLUMN "amount" TYPE NUMERIC(20, 4)
        USING ROUND(("amount")::double precision::numeric, 2),
    ALTER COLUMN "customer_amount" TYPE NUMERIC(20, 4)
        USING ROUND(("customer_amount")::double precision::numeric, 2);
