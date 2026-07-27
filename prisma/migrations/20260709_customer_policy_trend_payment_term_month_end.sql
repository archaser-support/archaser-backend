-- CustomerPolicyTrend: payment-term month-end cutoff/substitute (policy config history parity).
-- Forward-only: existing rows stay NULL until the next daily snapshot run.

BEGIN;

ALTER TABLE "CustomerPolicyTrend"
  ADD COLUMN IF NOT EXISTS "payment_term_cutoff_day_of_month" INTEGER,
  ADD COLUMN IF NOT EXISTS "payment_term_substitute_day_of_month" INTEGER;

COMMIT;
