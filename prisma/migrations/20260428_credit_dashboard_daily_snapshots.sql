BEGIN;

CREATE TABLE IF NOT EXISTS "CreditDashboardDailySnapshot" (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    policy_id INTEGER,
    snapshot_date DATE NOT NULL,
    health_index DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_receivables DOUBLE PRECISION NOT NULL DEFAULT 0,
    compliant_exposure DOUBLE PRECISION NOT NULL DEFAULT 0,
    at_risk_exposure DOUBLE PRECISION NOT NULL DEFAULT 0,
    policy_risk_exposure DOUBLE PRECISION NOT NULL DEFAULT 0,
    policy_risk_exposure_customer_count INTEGER NOT NULL DEFAULT 0,
    gross_risk_exposure DOUBLE PRECISION NOT NULL DEFAULT 0,
    overdue_block_customer_count INTEGER NOT NULL DEFAULT 0,
    overdue_block_total_outstanding DOUBLE PRECISION NOT NULL DEFAULT 0,
    capacity_gap_total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    capacity_gap_customer_over_limit_count INTEGER NOT NULL DEFAULT 0,
    terms_breach_invoice_count INTEGER NOT NULL DEFAULT 0,
    terms_breach_total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    terms_breach_count_by_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
    without_policy_customer_count INTEGER NOT NULL DEFAULT 0,
    without_policy_total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    reporting_countdown_invoice_count INTEGER NOT NULL DEFAULT 0,
    reporting_countdown_total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    reporting_countdown_window_days INTEGER NOT NULL DEFAULT 0,
    limit_warnings_customer_count INTEGER NOT NULL DEFAULT 0,
    limit_warnings_total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    limit_warnings_threshold_pct INTEGER NOT NULL DEFAULT 0,
    limit_warnings_score_warn_days INTEGER NOT NULL DEFAULT 0,
    account_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    created_by VARCHAR(128),
    modified_by VARCHAR(128),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ux_credit_dashboard_daily_snapshot_scope_day"
ON "CreditDashboardDailySnapshot" (
    account_id,
    COALESCE(policy_id, 0),
    snapshot_date
);

CREATE INDEX IF NOT EXISTS "idx_credit_dashboard_daily_snapshot_account_day"
ON "CreditDashboardDailySnapshot" (account_id, snapshot_date DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "CronJob" WHERE name = 'Credit Dashboard Daily Snapshot') THEN
        INSERT INTO "CronJob" (
            name,
            cron_expression,
            active,
            created_at,
            modified_at,
            sort_order,
            timeout_period_seconds,
            alert_enabled,
            success_count_30d,
            failure_count_30d,
            timeout_count_30d
        )
        VALUES (
            'Credit Dashboard Daily Snapshot',
            '0 2 * * *',
            true,
            NOW(),
            NOW(),
            20,
            1800,
            true,
            0,
            0,
            0
        );
    ELSE
        UPDATE "CronJob"
        SET active = true, modified_at = NOW()
        WHERE name = 'Credit Dashboard Daily Snapshot';
    END IF;
END $$;

COMMIT;
