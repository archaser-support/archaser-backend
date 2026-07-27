-- Migration A: store capacity gap / uninsured on CustomerPolicy (multi-currency buckets).
-- Optional seed from legacy Customer.gap_in_base_currency onto active policy rows.

ALTER TABLE "CustomerPolicy"
  ADD COLUMN IF NOT EXISTS "capacity_gap_amount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "capacity_gap_amount_date" DATE,
  ADD COLUMN IF NOT EXISTS "uninsured_amount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "capacity_gap_amount1" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "capacity_gap_currency1" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "capacity_gap_amount2" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "capacity_gap_currency2" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "uninsured_amount1" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "uninsured_currency1" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "uninsured_amount2" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "uninsured_currency2" VARCHAR(16);

-- Seed account-level gap from Customer onto active policy (full recalc still required for buckets/uninsured).
UPDATE "CustomerPolicy" cp
SET
  "capacity_gap_amount" = c."gap_in_base_currency",
  "capacity_gap_amount_date" = c."gap_in_base_currency_date"
FROM "Customer" c
WHERE cp."customer_id" = c."id"
  AND cp."is_active" = true
  AND c."gap_in_base_currency" IS NOT NULL
  AND cp."capacity_gap_amount" IS NULL;
