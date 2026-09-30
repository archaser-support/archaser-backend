-- Fix CreditDashboardDailySnapshot unique index expression types for ON CONFLICT.
-- Some environments ended up with:
--   COALESCE((policy_id)::bigint, (0)::bigint)
-- while batch upsert uses:
--   ON CONFLICT (account_id, (COALESCE(policy_id, 0)), (COALESCE(business_unit_id, 0)), snapshot_date)
-- Postgres requires an exact expression match (error 42P10).
-- Recreate the index with integer COALESCE to match int4 columns and the app SQL.

DROP INDEX IF EXISTS "ux_credit_dashboard_daily_snapshot_scope_day";

CREATE UNIQUE INDEX "ux_credit_dashboard_daily_snapshot_scope_day"
ON "CreditDashboardDailySnapshot" (
    account_id,
    COALESCE(policy_id, 0),
    COALESCE(business_unit_id, 0),
    snapshot_date
);
