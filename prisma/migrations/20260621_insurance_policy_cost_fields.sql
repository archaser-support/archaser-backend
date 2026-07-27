-- Migration: Insurance policy cost calculation fields

CREATE TYPE "cost_calculation_method" AS ENUM ('ActualSales', 'Limit');

ALTER TABLE "InsurancePolicy"
  ADD COLUMN IF NOT EXISTS "cost_calculation_method" "cost_calculation_method",
  ADD COLUMN IF NOT EXISTS "cost_percent" DECIMAL(10, 2);
