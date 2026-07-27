-- Migration B (gated): drop legacy Customer gap columns after batch recalc validation passes.

ALTER TABLE "Customer"
  DROP COLUMN IF EXISTS "gap_in_base_currency",
  DROP COLUMN IF EXISTS "gap_in_base_currency_date";
