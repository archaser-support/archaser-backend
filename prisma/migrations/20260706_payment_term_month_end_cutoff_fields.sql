-- InsurancePolicy & CustomerPolicy: optional payment-term month-end cutoff/substitute day-of-month fields.
-- When set, payment-term breach compares credit_days against max_payment_term + diff for on/after-cutoff invoices.

ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "payment_term_cutoff_day_of_month" INTEGER;
ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "payment_term_substitute_day_of_month" INTEGER;

ALTER TABLE "CustomerPolicy" ADD COLUMN IF NOT EXISTS "payment_term_cutoff_day_of_month" INTEGER;
ALTER TABLE "CustomerPolicy" ADD COLUMN IF NOT EXISTS "payment_term_substitute_day_of_month" INTEGER;
