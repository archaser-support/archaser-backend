-- Raise cost_percent / registration_fee_percent scale from 2 to 3 decimals
-- so values like 0.123 are stored without rounding to 0.12.

ALTER TABLE "InsurancePolicy"
  ALTER COLUMN "cost_percent" TYPE DECIMAL(10, 3),
  ALTER COLUMN "registration_fee_percent" TYPE DECIMAL(10, 3);

ALTER TABLE "InsurancePolicyTrend"
  ALTER COLUMN "cost_percent" TYPE DECIMAL(10, 3),
  ALTER COLUMN "registration_fee_percent" TYPE DECIMAL(10, 3);

ALTER TABLE "CustomerPolicy"
  ALTER COLUMN "cost_percent" TYPE DECIMAL(10, 3),
  ALTER COLUMN "registration_fee_percent" TYPE DECIMAL(10, 3);

ALTER TABLE "CustomerPolicyTrend"
  ALTER COLUMN "cost_percent" TYPE DECIMAL(10, 3),
  ALTER COLUMN "registration_fee_percent" TYPE DECIMAL(10, 3);
