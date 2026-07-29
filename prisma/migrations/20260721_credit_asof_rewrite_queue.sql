BEGIN;

-- Coalesced as-of rewrite queue (PRD: as-of-daily-snapshot-rewrite).
-- One pending row per account is widened/unioned by enqueue; drained by the
-- daily CPT snapshot cron to recompute historical rows.
-- Idempotent: shared DB may already have the table from a prior monolith deploy.
CREATE TABLE IF NOT EXISTS "CreditAsOfRewriteQueue" (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    customer_ids INTEGER[] NOT NULL DEFAULT '{}',
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_credit_asof_rewrite_queue_status_account"
ON "CreditAsOfRewriteQueue" (status, account_id);

COMMIT;
