-- Migration: Add premium and premium_currency columns to CustomerTopUp table
ALTER TABLE "CustomerTopUp"
  ADD COLUMN IF NOT EXISTS "premium" DECIMAL(20, 4),
  ADD COLUMN IF NOT EXISTS "premium_currency" VARCHAR(16);
