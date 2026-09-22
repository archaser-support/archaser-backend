-- ============================================================================
-- Add VAT breakdown columns to customer unpaid invoice system reports.
-- Idempotent: inserts after customer_amount when missing.
--
-- Run: npx prisma db execute --schema prisma/schema.prisma \
--   --file scripts/database/ensure-vat-fields-on-unpaid-invoice-reports.sql
-- ============================================================================

BEGIN;

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

COMMIT;
