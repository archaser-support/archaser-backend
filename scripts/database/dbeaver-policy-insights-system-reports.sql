-- ============================================================================
-- DBeaver: Policy Insights system reports (+ VAT columns on unpaid variants)
-- Context: customer_unpaid_invoices
-- ============================================================================
--
-- Idempotent. Run as a single script against the target Postgres DB
-- (e.g. local / staging / CI).
-- No top-level BEGIN/COMMIT (CI / prisma db execute already opens a transaction).
--
-- What it does:
-- 1-4) Upsert four Policy Insights system reports for all non-deleted accounts
-- 5) Prefer report_config from existing custom "with Policy Insights" views
-- 6) Re-point user defaults, delete those customs
-- 7) Ensure VAT breakdown fields on unpaid basic + Policy Insights reports
-- 8) Verification SELECT
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Unpaid Invoices with Policy Insights (default for CI accounts)
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
    'Unpaid Invoices with Policy Insights' AS name,
    'all_unpaid_invoices_credit_insurance_policy_insights' AS unique_name,
    'Unpaid invoices (Due and Overdue) with policy insight columns' AS description,
    '{
        "joins": [],
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "id"},
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "status"},
            {"table": "Invoice", "field": "customer_amount"},
            {"table": "Invoice", "field": "customer_net_amount"},
            {"table": "Invoice", "field": "invoice_date"},
            {"table": "Invoice", "field": "due_date"},
            {"table": "Invoice", "field": "customer_total_paid"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "customer_currency"},
            {"table": "Invoice", "field": "target_mep_date"},
            {"table": "Invoice", "field": "target_reporting_date"},
            {"table": "Invoice", "field": "capacity_gap_amount"},
            {"table": "Invoice", "field": "terms_breach_reason"}
        ],
        "filters": [
            {
                "table": "Invoice",
                "field": "status",
                "operator": "in",
                "value": ["Overdue", "Due"]
            },
            {
                "table": "Invoice",
                "field": "customer_outstanding_debt",
                "operator": "greater_than",
                "value": 0
            }
        ],
        "sorting": [
            {"field": "invoice_number", "direction": "DESC"}
        ],
        "grouping": [],
        "columnOrder": [
            "Invoice.id",
            "Invoice.invoice_number",
            "Invoice.status",
            "Invoice.customer_amount",
            "Invoice.customer_net_amount",
            "Invoice.invoice_date",
            "Invoice.due_date",
            "Invoice.customer_total_paid",
            "Invoice.customer_outstanding_debt",
            "Invoice.customer_currency",
            "Invoice.target_mep_date",
            "Invoice.target_reporting_date",
            "Invoice.capacity_gap_amount",
            "Invoice.terms_breach_reason"
        ],
        "primaryTable": "Invoice"
    }'::jsonb AS report_config,
    true AS is_public,
    true AS is_system,
    true AS is_default,
    'customer_unpaid_invoices' AS context,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM "Account" a
WHERE a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name)
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = true,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- ---------------------------------------------------------------------------
-- 2) Due Invoices with Policy Insights
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
    'Due Invoices with Policy Insights' AS name,
    'due_invoices_credit_insurance_policy_insights' AS unique_name,
    'Due invoices with policy insight columns' AS description,
    '{
        "joins": [],
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "id"},
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "status"},
            {"table": "Invoice", "field": "customer_amount"},
            {"table": "Invoice", "field": "customer_net_amount"},
            {"table": "Invoice", "field": "invoice_date"},
            {"table": "Invoice", "field": "due_date"},
            {"table": "Invoice", "field": "customer_total_paid"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "customer_currency"},
            {"table": "Invoice", "field": "target_mep_date"},
            {"table": "Invoice", "field": "target_reporting_date"},
            {"table": "Invoice", "field": "capacity_gap_amount"},
            {"table": "Invoice", "field": "terms_breach_reason"}
        ],
        "filters": [
            {
                "table": "Invoice",
                "field": "status",
                "operator": "equals",
                "value": "Due"
            },
            {
                "table": "Invoice",
                "field": "customer_outstanding_debt",
                "operator": "greater_than",
                "value": 0
            }
        ],
        "sorting": [
            {"field": "invoice_number", "direction": "DESC"}
        ],
        "grouping": [],
        "columnOrder": [
            "Invoice.id",
            "Invoice.invoice_number",
            "Invoice.status",
            "Invoice.customer_amount",
            "Invoice.customer_net_amount",
            "Invoice.invoice_date",
            "Invoice.due_date",
            "Invoice.customer_total_paid",
            "Invoice.customer_outstanding_debt",
            "Invoice.customer_currency",
            "Invoice.target_mep_date",
            "Invoice.target_reporting_date",
            "Invoice.capacity_gap_amount",
            "Invoice.terms_breach_reason"
        ],
        "primaryTable": "Invoice"
    }'::jsonb AS report_config,
    true AS is_public,
    true AS is_system,
    false AS is_default,
    'customer_unpaid_invoices' AS context,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM "Account" a
WHERE a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name)
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = false,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- ---------------------------------------------------------------------------
-- 3) Overdue Invoices with Policy Insights
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
    'Overdue Invoices with Policy Insights' AS name,
    'overdue_invoices_credit_insurance_policy_insights' AS unique_name,
    'Overdue invoices with policy insight columns' AS description,
    '{
        "joins": [],
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "id"},
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "status"},
            {"table": "Invoice", "field": "customer_amount"},
            {"table": "Invoice", "field": "customer_net_amount"},
            {"table": "Invoice", "field": "invoice_date"},
            {"table": "Invoice", "field": "due_date"},
            {"table": "Invoice", "field": "customer_total_paid"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Invoice", "field": "customer_currency"},
            {"table": "Invoice", "field": "target_mep_date"},
            {"table": "Invoice", "field": "target_reporting_date"},
            {"table": "Invoice", "field": "capacity_gap_amount"},
            {"table": "Invoice", "field": "terms_breach_reason"}
        ],
        "filters": [
            {
                "table": "Invoice",
                "field": "status",
                "operator": "equals",
                "value": "Overdue"
            },
            {
                "table": "Invoice",
                "field": "customer_outstanding_debt",
                "operator": "greater_than",
                "value": 0
            }
        ],
        "sorting": [
            {"field": "invoice_number", "direction": "DESC"}
        ],
        "grouping": [],
        "columnOrder": [
            "Invoice.id",
            "Invoice.invoice_number",
            "Invoice.status",
            "Invoice.customer_amount",
            "Invoice.customer_net_amount",
            "Invoice.invoice_date",
            "Invoice.due_date",
            "Invoice.customer_total_paid",
            "Invoice.customer_outstanding_debt",
            "Invoice.customer_currency",
            "Invoice.target_mep_date",
            "Invoice.target_reporting_date",
            "Invoice.capacity_gap_amount",
            "Invoice.terms_breach_reason"
        ],
        "primaryTable": "Invoice"
    }'::jsonb AS report_config,
    true AS is_public,
    true AS is_system,
    false AS is_default,
    'customer_unpaid_invoices' AS context,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM "Account" a
WHERE a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name)
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = false,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- ---------------------------------------------------------------------------
-- 4) All Invoices with Policy Insights
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
    'All Invoices with Policy Insights' AS name,
    'all_invoices_credit_insurance_policy_insights' AS unique_name,
    'All invoices with policy insight columns' AS description,
    '{
        "joins": [],
        "tables": ["Invoice"],
        "fields": [
            {"table": "Invoice", "field": "id"},
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "invoice_date"},
            {"table": "Invoice", "field": "due_date"},
            {"table": "Invoice", "field": "amount"},
            {"table": "Invoice", "field": "customer_amount"},
            {"table": "Invoice", "field": "customer_currency"},
            {"table": "Invoice", "field": "total_paid"},
            {"table": "Invoice", "field": "credit_for_invoice_number"},
            {"table": "Invoice", "field": "status"},
            {"table": "Invoice", "field": "target_mep_date"},
            {"table": "Invoice", "field": "target_reporting_date"},
            {"table": "Invoice", "field": "capacity_gap_amount"},
            {"table": "Invoice", "field": "terms_breach_reason"}
        ],
        "filters": [],
        "sorting": [
            {"field": "Invoice.invoice_number", "direction": "ASC"}
        ],
        "grouping": [],
        "columnOrder": [
            "Invoice.id",
            "Invoice.invoice_number",
            "Invoice.invoice_date",
            "Invoice.due_date",
            "Invoice.amount",
            "Invoice.customer_amount",
            "Invoice.customer_currency",
            "Invoice.total_paid",
            "Invoice.credit_for_invoice_number",
            "Invoice.status",
            "Invoice.target_mep_date",
            "Invoice.target_reporting_date",
            "Invoice.capacity_gap_amount",
            "Invoice.terms_breach_reason"
        ],
        "primaryTable": "Invoice"
    }'::jsonb AS report_config,
    true AS is_public,
    true AS is_system,
    false AS is_default,
    'customer_unpaid_invoices' AS context,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM "Account" a
WHERE a.deleted_at IS NULL
ON CONFLICT (account_id, unique_name)
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    report_config = EXCLUDED.report_config,
    is_public = EXCLUDED.is_public,
    is_system = true,
    is_default = false,
    context = EXCLUDED.context,
    modified_at = NOW(),
    modified_by = NULL;

-- Clear is_default on other Policy Insights variants (Unpaid is default among CI set).
-- Do not touch basic all_invoices / all_unpaid_invoices defaults.
UPDATE "Report"
SET is_default = false,
    modified_at = NOW()
WHERE context = 'customer_unpaid_invoices'
  AND unique_name IN (
      'all_invoices_credit_insurance_policy_insights',
      'due_invoices_credit_insurance_policy_insights',
      'overdue_invoices_credit_insurance_policy_insights'
  )
  AND is_default = true;

-- ---------------------------------------------------------------------------
-- 5) Prefer existing custom Policy Insights report_config when present
-- ---------------------------------------------------------------------------
UPDATE "Report" sys
SET
    report_config = custom.report_config,
    description = COALESCE(NULLIF(custom.description, ''), sys.description),
    modified_at = NOW()
FROM "Report" custom
WHERE custom.account_id = sys.account_id
  AND custom.context = 'customer_unpaid_invoices'
  AND custom.is_system = false
  AND sys.context = 'customer_unpaid_invoices'
  AND sys.is_system = true
  AND (
      (custom.name ILIKE 'Unpaid Invoices with Policy Insights'
       AND sys.unique_name = 'all_unpaid_invoices_credit_insurance_policy_insights')
      OR (custom.name ILIKE 'Due Invoices with Policy Insights'
          AND sys.unique_name = 'due_invoices_credit_insurance_policy_insights')
      OR (custom.name ILIKE 'Overdue Invoices with Policy Insights'
          AND sys.unique_name = 'overdue_invoices_credit_insurance_policy_insights')
      OR (custom.name ILIKE 'All Invoices with Policy Insights'
          AND sys.unique_name = 'all_invoices_credit_insurance_policy_insights')
  );

-- ---------------------------------------------------------------------------
-- 6) Re-point user defaults from custom Policy Insights â†’ system rows, then
--    delete customs so they do not stay under Custom Views
-- ---------------------------------------------------------------------------
UPDATE "UserDefaultReport" udr
SET report_id = sys.id
FROM "Report" custom
JOIN "Report" sys
  ON sys.account_id = custom.account_id
 AND sys.context = 'customer_unpaid_invoices'
 AND sys.is_system = true
 AND (
     (custom.name ILIKE 'Unpaid Invoices with Policy Insights'
      AND sys.unique_name = 'all_unpaid_invoices_credit_insurance_policy_insights')
     OR (custom.name ILIKE 'Due Invoices with Policy Insights'
         AND sys.unique_name = 'due_invoices_credit_insurance_policy_insights')
     OR (custom.name ILIKE 'Overdue Invoices with Policy Insights'
         AND sys.unique_name = 'overdue_invoices_credit_insurance_policy_insights')
     OR (custom.name ILIKE 'All Invoices with Policy Insights'
         AND sys.unique_name = 'all_invoices_credit_insurance_policy_insights')
 )
WHERE udr.report_id = custom.id
  AND custom.context = 'customer_unpaid_invoices'
  AND custom.is_system = false
  AND custom.name ILIKE '%with Policy Insights';

DELETE FROM "Report"
WHERE context = 'customer_unpaid_invoices'
  AND is_system = false
  AND name ILIKE '%with Policy Insights';

-- ---------------------------------------------------------------------------
-- 7) Ensure VAT columns on unpaid system reports (basic + Policy Insights)
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
      'overdue_invoices',
      'all_unpaid_invoices_credit_insurance_policy_insights',
      'due_invoices_credit_insurance_policy_insights',
      'overdue_invoices_credit_insurance_policy_insights'
  );

-- ---------------------------------------------------------------------------
-- 8) Verification
-- ---------------------------------------------------------------------------
SELECT unique_name, COUNT(*) AS accounts, bool_or(is_default) AS any_default
FROM "Report"
WHERE unique_name LIKE '%credit_insurance_policy_insights'
GROUP BY unique_name
ORDER BY unique_name;
