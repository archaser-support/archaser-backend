BEGIN;

ALTER TABLE "CreditDashboardDailySnapshot"
ADD COLUMN IF NOT EXISTS business_unit_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'CreditDashboardDailySnapshot_business_unit_id_fkey'
    ) THEN
        ALTER TABLE "CreditDashboardDailySnapshot"
        ADD CONSTRAINT "CreditDashboardDailySnapshot_business_unit_id_fkey"
        FOREIGN KEY (business_unit_id) REFERENCES "BusinessUnit"(id)
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

DROP INDEX IF EXISTS "ux_credit_dashboard_daily_snapshot_scope_day";
DROP INDEX IF EXISTS "ux_credit_dashboard_snapshot_scope_day";

CREATE UNIQUE INDEX IF NOT EXISTS "ux_credit_dashboard_daily_snapshot_scope_day"
ON "CreditDashboardDailySnapshot" (
    account_id,
    COALESCE(policy_id, 0),
    COALESCE(business_unit_id, 0),
    snapshot_date
);

CREATE INDEX IF NOT EXISTS "idx_credit_dashboard_daily_snapshot_bu_day"
ON "CreditDashboardDailySnapshot" (account_id, business_unit_id, snapshot_date DESC);

COMMIT;
