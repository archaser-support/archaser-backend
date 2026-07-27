-- Invoice-level dual-currency capacity gap storage (nullable rollout).

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "capacity_gap_amount" DECIMAL(20, 4),
ADD COLUMN IF NOT EXISTS "capacity_gap_amount_limit" DECIMAL(20, 4),
ADD COLUMN IF NOT EXISTS "capacity_gap_amount_date" DATE;

CREATE INDEX IF NOT EXISTS "idx_invoice_gap_rollup"
ON "Invoice" ("account_id", "customer_id", "policy_id", "status");
