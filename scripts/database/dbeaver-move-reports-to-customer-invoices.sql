-- ============================================================================
-- DBeaver: Move Limits VS AR / Risk exposures / date compare / Monthly Report
-- (local) into Customer Invoices system views
-- ============================================================================
--
-- Context change: reports → customer_unpaid_invoices
-- (unique_name is per-account unique, so one row cannot live in both contexts)
--
-- Also promotes leftover customs with those names to system and copies to all
-- accounts from master 10013.
--
-- Note: Limits VS AR and Risk exposures are Customer-grain reports. The invoices
-- tab always adds Invoice.customer_id; invoice-grain reports (date compare,
-- Monthly Report local) work best there.
-- No top-level BEGIN/COMMIT (CI / prisma db execute already opens a transaction).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Resolve sources (prefer account 10149)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tmp_invoice_tab_sources ON COMMIT DROP AS
WITH candidates AS (
    SELECT
        r.id,
        r.account_id,
        r.name,
        r.unique_name AS source_unique_name,
        r.description,
        r.report_config,
        r.is_public,
        r.created_by,
        r.modified_by,
        CASE
            WHEN r.unique_name = 'limits_vs_ar'
              OR r.name ILIKE 'Limits VS AR'
                THEN 'limits_vs_ar'
            WHEN r.unique_name = 'risk_exposure'
              OR r.name ILIKE 'Risk exposure%'
                THEN 'risk_exposure'
            WHEN r.unique_name = 'date_compare'
              OR r.name ILIKE '%Invoice date%due date%'
              OR r.name ILIKE 'Date compare'
                THEN 'date_compare'
            WHEN r.unique_name IN ('monthly_report_local', 'monthly_report_local_')
              OR r.name ILIKE 'Monthly Report (local)'
                THEN 'monthly_report_local'
            ELSE NULL
        END AS target_unique_name
    FROM "Report" r
)
SELECT DISTINCT ON (c.target_unique_name)
    c.id,
    c.account_id,
    c.name,
    c.source_unique_name,
    c.target_unique_name,
    c.description,
    c.report_config,
    c.is_public,
    c.created_by,
    c.modified_by
FROM candidates c
WHERE c.target_unique_name IS NOT NULL
ORDER BY
    c.target_unique_name,
    (c.account_id = 10149) DESC,
    c.id DESC;

DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(expected, ', ')
    INTO missing
    FROM (
        SELECT unnest(ARRAY[
            'limits_vs_ar',
            'risk_exposure',
            'date_compare',
            'monthly_report_local'
        ]) AS expected
    ) e
    WHERE NOT EXISTS (
        SELECT 1
        FROM tmp_invoice_tab_sources s
        WHERE s.target_unique_name = e.expected
    );

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION
            'Missing source report(s) for: %. Create/find those reports first.',
            missing;
    END IF;
END $$;

UPDATE tmp_invoice_tab_sources s
SET
    name = v.name,
    description = v.description
FROM (
    VALUES
        (
            'limits_vs_ar',
            'Limits VS AR',
            'Customer name, number, approved limit, open receivables (AR), and limit type. No filters (all customers).'
        ),
        (
            'risk_exposure',
            'Risk exposures',
            'Customer name, number, open receivables, at-risk exposure, terms breach outstanding, and capacity gap. Only customers where open receivables is not zero.'
        ),
        (
            'date_compare',
            'Invoice date & due date are the same',
            'Customer name with invoice date, due date, and amount without VAT. Filters: invoice date is last month, invoice date equals due date (The Same = Yes), and parent customer name is empty.'
        ),
        (
            'monthly_report_local',
            'Monthly Report (local)',
            'All customer invoices'
        )
) AS v(target_unique_name, name, description)
WHERE s.target_unique_name = v.target_unique_name;

-- ---------------------------------------------------------------------------
-- 1) Refresh source rows, then move all matching unique_names to invoices tab
-- ---------------------------------------------------------------------------
UPDATE "Report" r
SET
    is_system = TRUE,
    is_default = FALSE,
    context = 'customer_unpaid_invoices',
    name = s.name,
    unique_name = s.target_unique_name,
    description = s.description,
    report_config = s.report_config,
    modified_at = NOW()
FROM tmp_invoice_tab_sources s
WHERE r.id = s.id;

UPDATE "Report"
SET
    is_system = TRUE,
    is_default = FALSE,
    context = 'customer_unpaid_invoices',
    modified_at = NOW()
WHERE unique_name IN (
    'limits_vs_ar',
    'risk_exposure',
    'date_compare',
    'monthly_report_local',
    'monthly_report_local_'
);

-- Normalize legacy unique_name
UPDATE "Report"
SET
    unique_name = 'monthly_report_local',
    name = 'Monthly Report (local)',
    is_system = TRUE,
    is_default = FALSE,
    context = 'customer_unpaid_invoices',
    modified_at = NOW()
WHERE unique_name = 'monthly_report_local_';

-- ---------------------------------------------------------------------------
-- 2) Upsert onto master 10013
-- ---------------------------------------------------------------------------
INSERT INTO "Report" (
    account_id,
    name,
    unique_name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT
    10013 AS account_id,
    s.name,
    s.target_unique_name AS unique_name,
    s.description,
    s.report_config,
    COALESCE(s.is_public, TRUE) AS is_public,
    TRUE AS is_system,
    FALSE AS is_default,
    'customer_unpaid_invoices' AS context,
    NOW() AS created_at,
    NOW() AS modified_at,
    s.created_by,
    s.modified_by
FROM tmp_invoice_tab_sources s
ON CONFLICT (account_id, unique_name)
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = TRUE,
    is_default = FALSE,
    context = 'customer_unpaid_invoices',
    modified_at = NOW(),
    modified_by = EXCLUDED.modified_by;

-- ---------------------------------------------------------------------------
-- 3) Copy to all other accounts
-- ---------------------------------------------------------------------------
INSERT INTO "Report" (
    account_id,
    name,
    unique_name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT
    a.id AS account_id,
    m.name,
    m.unique_name,
    m.description,
    m.report_config,
    m.is_public,
    TRUE AS is_system,
    FALSE AS is_default,
    m.context,
    NOW() AS created_at,
    NOW() AS modified_at,
    m.created_by,
    m.modified_by
FROM "Account" a
CROSS JOIN (
    SELECT
        r.name,
        r.unique_name,
        r.description,
        r.report_config,
        r.is_public,
        r.context,
        r.created_by,
        r.modified_by
    FROM "Report" r
    WHERE r.account_id = 10013
      AND r.is_system = TRUE
      AND r.context = 'customer_unpaid_invoices'
      AND r.unique_name IN (
          'limits_vs_ar',
          'risk_exposure',
          'date_compare',
          'monthly_report_local'
      )
) m
WHERE a.id <> 10013
  AND a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name)
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = TRUE,
    is_default = FALSE,
    context = 'customer_unpaid_invoices',
    modified_at = NOW(),
    modified_by = EXCLUDED.modified_by;

-- ---------------------------------------------------------------------------
-- 4) Remove leftover customs with the same display names
-- ---------------------------------------------------------------------------
UPDATE "UserDefaultReport" udr
SET report_id = sys.id
FROM "Report" custom
JOIN "Report" sys
  ON sys.account_id = custom.account_id
 AND sys.context = 'customer_unpaid_invoices'
 AND sys.is_system = TRUE
 AND sys.unique_name IN (
     'limits_vs_ar',
     'risk_exposure',
     'date_compare',
     'monthly_report_local'
 )
 AND (
     (custom.name ILIKE 'Limits VS AR' AND sys.unique_name = 'limits_vs_ar')
     OR (custom.name ILIKE 'Risk exposure%' AND sys.unique_name = 'risk_exposure')
     OR (
         (custom.name ILIKE '%Invoice date%due date%' OR custom.name ILIKE 'Date compare')
         AND sys.unique_name = 'date_compare'
     )
     OR (
         custom.name ILIKE 'Monthly Report (local)'
         AND sys.unique_name = 'monthly_report_local'
     )
 )
WHERE udr.report_id = custom.id
  AND custom.is_system = FALSE;

DELETE FROM "Report" custom
WHERE custom.is_system = FALSE
  AND (
      custom.name ILIKE 'Limits VS AR'
      OR custom.name ILIKE 'Risk exposure%'
      OR custom.name ILIKE '%Invoice date%due date%'
      OR custom.name ILIKE 'Date compare'
      OR custom.name ILIKE 'Monthly Report (local)'
      OR custom.unique_name = 'monthly_report_local_'
  )
  AND EXISTS (
      SELECT 1
      FROM "Report" sys
      WHERE sys.account_id = custom.account_id
        AND sys.is_system = TRUE
        AND sys.context = 'customer_unpaid_invoices'
        AND sys.unique_name IN (
            'limits_vs_ar',
            'risk_exposure',
            'date_compare',
            'monthly_report_local'
        )
  );

-- Verification: should be customer_unpaid_invoices
SELECT unique_name, context, bool_and(is_system) AS all_system, COUNT(*) AS accounts
FROM "Report"
WHERE unique_name IN (
    'limits_vs_ar',
    'risk_exposure',
    'date_compare',
    'monthly_report_local'
)
GROUP BY unique_name, context
ORDER BY unique_name, context;
