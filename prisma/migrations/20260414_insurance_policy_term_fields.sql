-- InsurancePolicy: policy-level max payment term, max MEP, and reporting days (optional integers).
-- Matches naming on Customer (max_payment_term, max_allowed_mep, reporting_days).

ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "max_payment_term" INTEGER;
ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "max_allowed_mep" INTEGER;
ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "reporting_days" INTEGER;
