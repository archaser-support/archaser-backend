-- ============================================================================
-- Apply account VAT include/exclude schema + report field updates.
-- Idempotent. Safe to re-run.
--
-- Covers:
--   prisma/migrations/20260922_account_amounts_include_vat.sql
--   prisma/migrations/20260922_invoice_vat_amount_fields.sql
--   prisma/migrations/20260922_account_background_job.sql
--   scripts/database/ensure-vat-fields-on-unpaid-invoice-reports.sql
--
-- Run:
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/database/apply-account-vat-include-exclude.sql
--
-- No BEGIN/COMMIT here: prisma db execute (and many clients) already wrap
-- the file in a transaction; nested BEGIN causes
-- "there is already a transaction in progress".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Account.amounts_include_vat (default include = true)
-- ---------------------------------------------------------------------------
ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS "amounts_include_vat" BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2) Invoice VAT breakdown (nullable). amount / customer_amount remain with-VAT.
-- ---------------------------------------------------------------------------
ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "amount_without_vat" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "vat_amount" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "customer_amount_without_vat" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "customer_vat_amount" DOUBLE PRECISION;

-- ---------------------------------------------------------------------------
-- 3) AccountBackgroundJob (replaces CreditAsOfBackfillJob + AccountVatBasisRefreshJob)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4) System unpaid-invoice reports: insert VAT fields after customer_amount
-- ---------------------------------------------------------------------------
UPDATE "Report" r
SET
    report_config = jsonb_set(
        r.report_config,
        '{fields}',
        (
            SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
            FROM (
                SELECT
                    f.elem,
                    f.ord::numeric AS ord
                FROM jsonb_array_elements(r.report_config->'fields')
                    WITH ORDINALITY AS f(elem, ord)
                WHERE NOT (
                    f.elem->>'table' = 'Invoice'
                    AND f.elem->>'field' IN (
                        'customer_amount_without_vat',
                        'customer_vat_amount'
                    )
                )
                UNION ALL
                SELECT
                    '{"table":"Invoice","field":"customer_amount_without_vat"}'::jsonb,
                    (
                        SELECT COALESCE(MAX(x.ord), 0)::numeric + 0.1
                        FROM jsonb_array_elements(r.report_config->'fields')
                            WITH ORDINALITY AS x(elem, ord)
                        WHERE x.elem->>'table' = 'Invoice'
                          AND x.elem->>'field' = 'customer_amount'
                    )
                WHERE EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(r.report_config->'fields') AS y
                    WHERE y->>'table' = 'Invoice'
                      AND y->>'field' = 'customer_amount'
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(r.report_config->'fields') AS z
                    WHERE z->>'table' = 'Invoice'
                      AND z->>'field' = 'customer_amount_without_vat'
                )
                UNION ALL
                SELECT
                    '{"table":"Invoice","field":"customer_vat_amount"}'::jsonb,
                    (
                        SELECT COALESCE(MAX(x.ord), 0)::numeric + 0.2
                        FROM jsonb_array_elements(r.report_config->'fields')
                            WITH ORDINALITY AS x(elem, ord)
                        WHERE x.elem->>'table' = 'Invoice'
                          AND x.elem->>'field' = 'customer_amount'
                    )
                WHERE EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(r.report_config->'fields') AS y
                    WHERE y->>'table' = 'Invoice'
                      AND y->>'field' = 'customer_amount'
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(r.report_config->'fields') AS z
                    WHERE z->>'table' = 'Invoice'
                      AND z->>'field' = 'customer_vat_amount'
                )
            ) AS combined(elem, ord)
        )
    ),
    modified_at = NOW(),
    modified_by = NULL
WHERE r.is_system = true
  AND r.context = 'customer_unpaid_invoices'
  AND r.unique_name IN (
      'all_unpaid_invoices',
      'due_invoices',
      'overdue_invoices'
  );
