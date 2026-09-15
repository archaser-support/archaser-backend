-- Migration: Insurance policy Annual Credit Assessment Fee
-- Adds an optional money amount (account currency) charged per named customer
-- on the master policy. Forward-only, nullable. No backfill: policies without
-- a configured fee remain null. TopUp policies keep the fee null via API rules.
-- No fee history / trend snapshot in MVP — Portfolio Health uses the live value.

ALTER TABLE "InsurancePolicy"
  ADD COLUMN IF NOT EXISTS "annual_credit_assessment_fee" DECIMAL(20, 4);
