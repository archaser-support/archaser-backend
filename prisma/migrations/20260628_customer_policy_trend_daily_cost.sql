-- Migration: Daily policy and top-up cost columns on CustomerPolicyTrend

ALTER TABLE "CustomerPolicyTrend"
  ADD COLUMN IF NOT EXISTS "policy_daily_cost" DECIMAL(20, 4),
  ADD COLUMN IF NOT EXISTS "policy_cost_currency" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "top_up_daily_cost" DECIMAL(20, 4),
  ADD COLUMN IF NOT EXISTS "top_up_cost_currency" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "total_daily_cost" DECIMAL(20, 4),
  ADD COLUMN IF NOT EXISTS "cost_calculation_method" "cost_calculation_method",
  ADD COLUMN IF NOT EXISTS "cost_percent" DECIMAL(10, 2);
