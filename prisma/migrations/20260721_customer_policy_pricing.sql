-- Migration: Customer policy pricing (Insurance Premium Rate + Registration Fee)
-- Persist the master-policy pricing contract on customer policy assignments so the
-- values can be exposed through customer-policy APIs and snapshotted in trends.
-- Forward-only, nullable columns using the existing percentage precision.

ALTER TABLE "CustomerPolicy"
  ADD COLUMN IF NOT EXISTS "cost_percent" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "registration_fee_percent" DECIMAL(10, 2);

-- Backfill ACTIVE customer policies from their linked master policy only.
-- Historical (is_active = false) versions cannot have their former rates
-- reconstructed reliably, so they are intentionally left untouched.
UPDATE "CustomerPolicy" cp
SET
  "cost_percent" = ip."cost_percent",
  "registration_fee_percent" = ip."registration_fee_percent"
FROM "InsurancePolicy" ip
WHERE cp."insurance_policy_id" = ip."id"
  AND cp."is_active" = true;
