-- Invoice VAT breakdown (nullable). amount / customer_amount remain with-VAT.

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "amount_without_vat" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "vat_amount" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "customer_amount_without_vat" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "customer_vat_amount" DOUBLE PRECISION;
