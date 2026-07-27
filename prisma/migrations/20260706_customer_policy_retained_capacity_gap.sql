-- CustomerPolicy KPI capacity rollup state (pairs with capacity_gap_amount KPI value).
ALTER TABLE "CustomerPolicy"
ADD COLUMN IF NOT EXISTS "retained_capacity_gap" DOUBLE PRECISION;
