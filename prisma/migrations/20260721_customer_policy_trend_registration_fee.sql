-- Migration: Customer policy trend registration fee
-- Adds the Registration Fee (%) column to the daily customer-policy trend snapshot.
-- The premium-rate column (cost_percent) already exists on CustomerPolicyTrend.
-- Forward-only, nullable. Existing historical trend rows keep a null registration
-- fee (no fabricated values); new snapshots source it from the synchronized
-- active customer policy.

ALTER TABLE "CustomerPolicyTrend"
  ADD COLUMN IF NOT EXISTS "registration_fee_percent" DECIMAL(10, 2);
