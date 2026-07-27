BEGIN;

CREATE TABLE IF NOT EXISTS "CustomerPolicyTrend" (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    insurance_policy_id INTEGER,
    customer_policy_id INTEGER,
    snapshot_date DATE NOT NULL,
    approved_limit DECIMAL(20, 4),
    usage_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    usage_pct DOUBLE PRECISION,
    customer_number_policy VARCHAR(255),
    approved_limit_currency VARCHAR(16),
    approved_limit_expiration_date DATE,
    limit_type "customer_limit_type",
    max_payment_term INTEGER,
    max_allowed_mep INTEGER,
    reporting_days INTEGER,
    excluded_from_policy BOOLEAN NOT NULL DEFAULT false,
    policy_exclusion_reason TEXT,
    credit_score DECIMAL(10, 2),
    credit_score_input_date DATE,
    active_customer_since DATE,
    outdated_dcl BOOLEAN NOT NULL DEFAULT false,
    created_by VARCHAR(128),
    modified_by VARCHAR(128),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT customer_policy_trend_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES "Customer"(id) ON DELETE CASCADE,
    CONSTRAINT customer_policy_trend_insurance_policy_id_fkey
        FOREIGN KEY (insurance_policy_id) REFERENCES "InsurancePolicy"(id),
    CONSTRAINT customer_policy_trend_customer_policy_id_fkey
        FOREIGN KEY (customer_policy_id) REFERENCES "CustomerPolicy"(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ux_customer_policy_trend_customer_day"
ON "CustomerPolicyTrend" (customer_id, snapshot_date);

CREATE INDEX IF NOT EXISTS "idx_customer_policy_trend_account_day"
ON "CustomerPolicyTrend" (account_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS "idx_customer_policy_trend_account_policy_day"
ON "CustomerPolicyTrend" (account_id, insurance_policy_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS "idx_customer_policy_trend_customer_day"
ON "CustomerPolicyTrend" (customer_id, snapshot_date DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "CronJob" WHERE name = 'Customer Policy Trend Daily Snapshot') THEN
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
            'Customer Policy Trend Daily Snapshot',
            '0 3 * * *',
            true,
            NOW(),
            NOW(),
            21,
            1800,
            true,
            0,
            0,
            0
        );
    ELSE
        UPDATE "CronJob"
        SET active = true, modified_at = NOW()
        WHERE name = 'Customer Policy Trend Daily Snapshot';
    END IF;
END $$;

COMMIT;
