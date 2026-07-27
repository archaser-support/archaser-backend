-- CustomerPolicyTrend: per-customer-policy daily row grain + snapshot KPI/config columns.
-- 1) Add MEP/reporting month-end cutoff-day ints copied from the source CustomerPolicy.
-- 2) Add financial KPI amount/pct columns + terms-breach breakdown (populated by the KPI slice).
-- 3) Move the daily row grain from one row per (customer, day) to one row per
--    (customer, customer_policy, day) so multi-policy customers get one row per assignment.

BEGIN;

-- --- New config columns (copied from CustomerPolicy at snapshot time) --------------------
ALTER TABLE "CustomerPolicyTrend"
  ADD COLUMN IF NOT EXISTS "mep_cutoff_day_of_month" INTEGER,
  ADD COLUMN IF NOT EXISTS "mep_substitute_day_of_month" INTEGER,
  ADD COLUMN IF NOT EXISTS "reporting_cutoff_day_of_month" INTEGER,
  ADD COLUMN IF NOT EXISTS "reporting_substitute_day_of_month" INTEGER;

-- --- New financial KPI columns (populated by the KPI snapshot slice) ---------------------
ALTER TABLE "CustomerPolicyTrend"
  ADD COLUMN IF NOT EXISTS "financial_currency" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "total_receivables" DECIMAL(20, 4),
  ADD COLUMN IF NOT EXISTS "health_index" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "at_risk_exposure" DECIMAL(20, 4),
  ADD COLUMN IF NOT EXISTS "compliant_exposure" DECIMAL(20, 4),
  ADD COLUMN IF NOT EXISTS "terms_breach_amount" DECIMAL(20, 4),
  ADD COLUMN IF NOT EXISTS "capacity_gap_amount" DECIMAL(20, 4),
  ADD COLUMN IF NOT EXISTS "terms_breach_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "terms_breach_by_reason" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "policy_usage_pct" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "top_up_usage_pct" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "effective_usage_pct" DOUBLE PRECISION;

-- --- Row grain migration -----------------------------------------------------------------
-- Legacy rows predate customer_policy_id and hold NULL. Backfill from the matching active
-- CustomerPolicy (one per customer+insurance policy, most recently modified wins), then drop
-- any that can't be matched. Daily snapshot data regenerates on the next cron run.
UPDATE "CustomerPolicyTrend" t
SET customer_policy_id = cp.id
FROM (
    SELECT DISTINCT ON (customer_id, insurance_policy_id)
        id,
        customer_id,
        insurance_policy_id
    FROM "CustomerPolicy"
    WHERE is_active = true
    ORDER BY customer_id, insurance_policy_id, modified_at DESC, id DESC
) cp
WHERE t.customer_policy_id IS NULL
  AND cp.customer_id = t.customer_id
  AND cp.insurance_policy_id IS NOT DISTINCT FROM t.insurance_policy_id;

DELETE FROM "CustomerPolicyTrend" WHERE customer_policy_id IS NULL;

-- Swap the daily uniqueness from (customer, day) to (customer, customer_policy, day).
DROP INDEX IF EXISTS "ux_customer_policy_trend_customer_day";

CREATE UNIQUE INDEX IF NOT EXISTS "ux_customer_policy_trend_customer_policy_day"
ON "CustomerPolicyTrend" (customer_id, customer_policy_id, snapshot_date);

COMMIT;
