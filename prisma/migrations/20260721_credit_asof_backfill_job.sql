BEGIN;

-- Admin-driven full-history as-of backfill job, one row per target account
-- (PRD: as-of-daily-snapshot-rewrite). Overnight drain skips accounts while
-- status is `running` or `paused`.
CREATE TABLE IF NOT EXISTS "CreditAsOfBackfillJob" (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'idle',
    from_date DATE,
    to_date DATE,
    checkpoint_date DATE,
    days_total INTEGER NOT NULL DEFAULT 0,
    days_done INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    requested_by VARCHAR(128),
    started_at TIMESTAMPTZ(6),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ux_credit_asof_backfill_job_account"
ON "CreditAsOfBackfillJob" (account_id);

COMMIT;
