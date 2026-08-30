BEGIN;

-- Retry queue for AR post-ingest step failures.
-- The orchestrator is best-effort: it logs step failures and lets ingest
-- succeed, which left customers with stale capacity gaps and no durable record.
-- One row per customer is enqueued here and retried by the overnight drain.
-- Idempotent: shared DB may already have the table from a prior deploy.
CREATE TABLE IF NOT EXISTS "ArPostIngestRetryQueue" (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    steps TEXT[] NOT NULL DEFAULT '{}',
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_ar_post_ingest_retry_account_customer"
ON "ArPostIngestRetryQueue" (account_id, customer_id);

CREATE INDEX IF NOT EXISTS "idx_ar_post_ingest_retry_status_account"
ON "ArPostIngestRetryQueue" (status, account_id);

COMMIT;
