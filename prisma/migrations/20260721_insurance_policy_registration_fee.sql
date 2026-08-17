-- Migration: Insurance policy registration fee percent
-- Adds an optional Registration Fee (%) to the master policy and its daily trend
-- snapshot. Registration Fee is a percentage of the calculated insurance premium
-- amount for future reporting; it does not participate in daily-cost calculations.
-- Forward-only, nullable columns using the existing percentage precision. No backfill:
-- Primary policies without a configured fee remain null, and TopUp policies keep it null.

ALTER TABLE "InsurancePolicy"
  ADD COLUMN IF NOT EXISTS "registration_fee_percent" DECIMAL(10, 2);

ALTER TABLE "InsurancePolicyTrend"
  ADD COLUMN IF NOT EXISTS "registration_fee_percent" DECIMAL(10, 2);
