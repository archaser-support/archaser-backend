BEGIN;

CREATE TABLE IF NOT EXISTS "InsurancePolicyTrend" (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    insurance_policy_id INTEGER NOT NULL,
    snapshot_date DATE NOT NULL,
    policy_number VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    currency VARCHAR(16),
    insurer_name VARCHAR(255),
    policy_kind "insurance_policy_kind" NOT NULL DEFAULT 'Primary',
    parent_insurance_policy_id INTEGER,
    allow_concurrent_top_ups BOOLEAN NOT NULL DEFAULT true,
    max_total_cover DECIMAL(20, 4),
    max_total_dcl_sdl_cover DECIMAL(20, 4),
    min_credit_score DECIMAL(10, 2),
    score_validity_period_months INTEGER,
    max_dcl DECIMAL(20, 4),
    dcl_customer_since_months INTEGER,
    max_payment_term INTEGER,
    max_allowed_mep INTEGER,
    reporting_days INTEGER,
    cost_calculation_method "cost_calculation_method",
    cost_percent DECIMAL(10, 2),
    status "record_status" NOT NULL DEFAULT 'Draft',
    active_customer_count INTEGER NOT NULL DEFAULT 0,
    total_approved_limit DECIMAL(20, 4),
    total_open_ar DOUBLE PRECISION NOT NULL DEFAULT 0,
    policy_usage_pct DOUBLE PRECISION,
    named_policy_row_count INTEGER NOT NULL DEFAULT 0,
    country_row_count INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(128),
    modified_by VARCHAR(128),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT insurance_policy_trend_insurance_policy_id_fkey
        FOREIGN KEY (insurance_policy_id) REFERENCES "InsurancePolicy"(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ux_insurance_policy_trend_policy_day"
ON "InsurancePolicyTrend" (insurance_policy_id, snapshot_date);

CREATE INDEX IF NOT EXISTS "idx_insurance_policy_trend_account_day"
ON "InsurancePolicyTrend" (account_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS "idx_insurance_policy_trend_account_policy_day"
ON "InsurancePolicyTrend" (account_id, insurance_policy_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS "InsurancePolicyCountryTrend" (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    insurance_policy_id INTEGER NOT NULL,
    insurance_policy_country_id UUID NOT NULL,
    country_id INTEGER NOT NULL,
    snapshot_date DATE NOT NULL,
    payment_term_cap INTEGER,
    country_mep INTEGER,
    reporting_days INTEGER,
    country_max_limit DECIMAL(20, 4),
    created_by VARCHAR(128),
    modified_by VARCHAR(128),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT insurance_policy_country_trend_country_row_fkey
        FOREIGN KEY (insurance_policy_country_id) REFERENCES "InsurancePolicyCountry"(id) ON DELETE CASCADE,
    CONSTRAINT insurance_policy_country_trend_policy_id_fkey
        FOREIGN KEY (insurance_policy_id) REFERENCES "InsurancePolicy"(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ux_insurance_policy_country_trend_row_day"
ON "InsurancePolicyCountryTrend" (insurance_policy_country_id, snapshot_date);

CREATE INDEX IF NOT EXISTS "idx_insurance_policy_country_trend_policy_day"
ON "InsurancePolicyCountryTrend" (insurance_policy_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS "idx_insurance_policy_country_trend_account_policy_day"
ON "InsurancePolicyCountryTrend" (account_id, insurance_policy_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS "NamedPolicyTrend" (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    insurance_policy_id INTEGER NOT NULL,
    named_policy_id INTEGER NOT NULL,
    snapshot_date DATE NOT NULL,
    customer_number VARCHAR(255) NOT NULL,
    max_payment_term INTEGER,
    customer_mep INTEGER,
    reporting_days INTEGER,
    customer_max_limit DECIMAL(20, 4),
    limit_expiration_date DATE,
    created_by VARCHAR(128),
    modified_by VARCHAR(128),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT named_policy_trend_named_policy_id_fkey
        FOREIGN KEY (named_policy_id) REFERENCES "NamedPolicy"(id) ON DELETE CASCADE,
    CONSTRAINT named_policy_trend_insurance_policy_id_fkey
        FOREIGN KEY (insurance_policy_id) REFERENCES "InsurancePolicy"(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ux_named_policy_trend_row_day"
ON "NamedPolicyTrend" (named_policy_id, snapshot_date);

CREATE INDEX IF NOT EXISTS "idx_named_policy_trend_policy_day"
ON "NamedPolicyTrend" (insurance_policy_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS "idx_named_policy_trend_account_policy_day"
ON "NamedPolicyTrend" (account_id, insurance_policy_id, snapshot_date DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "CronJob" WHERE name = 'Insurance Policy Trend Daily Snapshot') THEN
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
            'Insurance Policy Trend Daily Snapshot',
            '15 3 * * *',
            true,
            NOW(),
            NOW(),
            22,
            1800,
            true,
            0,
            0,
            0
        );
    ELSE
        UPDATE "CronJob"
        SET active = true, modified_at = NOW()
        WHERE name = 'Insurance Policy Trend Daily Snapshot';
    END IF;
END $$;

COMMIT;
