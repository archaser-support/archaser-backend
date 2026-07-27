-- InsurancePolicy & CustomerPolicy: optional month-end cutoff/substitute day-of-month fields.
-- When set, invoice target MEP/reporting dates roll to an early day in the month after the raw computed date.

ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "mep_cutoff_day_of_month" INTEGER;
ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "mep_substitute_day_of_month" INTEGER;
ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "reporting_cutoff_day_of_month" INTEGER;
ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "reporting_substitute_day_of_month" INTEGER;

ALTER TABLE "CustomerPolicy" ADD COLUMN IF NOT EXISTS "mep_cutoff_day_of_month" INTEGER;
ALTER TABLE "CustomerPolicy" ADD COLUMN IF NOT EXISTS "mep_substitute_day_of_month" INTEGER;
ALTER TABLE "CustomerPolicy" ADD COLUMN IF NOT EXISTS "reporting_cutoff_day_of_month" INTEGER;
ALTER TABLE "CustomerPolicy" ADD COLUMN IF NOT EXISTS "reporting_substitute_day_of_month" INTEGER;
