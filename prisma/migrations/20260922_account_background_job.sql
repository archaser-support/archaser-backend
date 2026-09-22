-- Shared per-account background job progress (as-of backfill + VAT basis refresh).
-- Replaces CreditAsOfBackfillJob and AccountVatBasisRefreshJob.

BEGIN;

CREATE TABLE IF NOT EXISTS "AccountBackgroundJob" (
    id               BIGSERIAL PRIMARY KEY,
    account_id       INT NOT NULL,
    job_kind         VARCHAR(64) NOT NULL,
    status           VARCHAR(16) NOT NULL DEFAULT 'idle',
    units_total      INT NOT NULL DEFAULT 0,
    units_done       INT NOT NULL DEFAULT 0,
    from_date        DATE,
    to_date          DATE,
    checkpoint_date  DATE,
    run_token        VARCHAR(64),
    last_error       TEXT,
    requested_by     VARCHAR(128),
    started_at       TIMESTAMPTZ(6),
    created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "AccountBackgroundJob_account_kind_uniq" UNIQUE (account_id, job_kind)
);

CREATE INDEX IF NOT EXISTS "AccountBackgroundJob_status_kind_idx"
ON "AccountBackgroundJob" (status, job_kind);

-- Copy existing as-of backfill rows (if the legacy table is still present).
DO $$
BEGIN
    IF to_regclass('public."CreditAsOfBackfillJob"') IS NOT NULL THEN
        INSERT INTO "AccountBackgroundJob" (
            account_id,
            job_kind,
            status,
            units_total,
            units_done,
            from_date,
            to_date,
            checkpoint_date,
            last_error,
            requested_by,
            started_at,
            created_at,
            updated_at
        )
        SELECT
            account_id,
            'credit_asof_backfill',
            status,
            days_total,
            days_done,
            from_date,
            to_date,
            checkpoint_date,
            last_error,
            requested_by,
            started_at,
            created_at,
            updated_at
        FROM "CreditAsOfBackfillJob"
        ON CONFLICT (account_id, job_kind) DO NOTHING;
    END IF;
END $$;

-- Copy VAT refresh rows if the short-lived duplicate table was already applied.
DO $$
BEGIN
    IF to_regclass('public."AccountVatBasisRefreshJob"') IS NOT NULL THEN
        INSERT INTO "AccountBackgroundJob" (
            account_id,
            job_kind,
            status,
            units_total,
            units_done,
            run_token,
            last_error,
            requested_by,
            started_at,
            created_at,
            updated_at
        )
        SELECT
            account_id,
            'vat_basis_refresh',
            status,
            customers_total,
            customers_done,
            run_token,
            last_error,
            requested_by,
            started_at,
            created_at,
            updated_at
        FROM "AccountVatBasisRefreshJob"
        ON CONFLICT (account_id, job_kind) DO NOTHING;
    END IF;
END $$;

DROP TABLE IF EXISTS "AccountVatBasisRefreshJob";
DROP TABLE IF EXISTS "CreditAsOfBackfillJob";

COMMIT;
