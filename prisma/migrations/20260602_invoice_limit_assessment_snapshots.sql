-- Invoice-level capacity gap snapshots
-- Safe nullable rollout; backfill can run asynchronously.

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "limit_assessed_amount" DECIMAL(20, 4),
ADD COLUMN IF NOT EXISTS "limit_assessed_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "limit_assessed_currency" VARCHAR(16);

CREATE INDEX IF NOT EXISTS "idx_invoice_limit_assessed_at"
ON "Invoice" ("limit_assessed_at");
