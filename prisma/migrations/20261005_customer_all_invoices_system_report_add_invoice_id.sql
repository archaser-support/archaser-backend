-- Add Invoice.id to the All Invoices system report fields (hidden from
-- columnOrder) so customer invoice grid actions can resolve the row id.
-- Follow-up: do not edit 20261005_customer_all_invoices_system_report.sql
-- after it was recorded by deploy_sql_applied.
--
-- Do not wrap in top-level BEGIN/COMMIT (CI / prisma db execute already
-- run inside a transaction).

UPDATE "Report"
SET
    report_config = jsonb_set(
        report_config,
        '{fields}',
        '[{"field": "id", "table": "Invoice"}]'::jsonb
            || COALESCE(report_config->'fields', '[]'::jsonb)
    ),
    modified_at = NOW()
WHERE unique_name = 'all_invoices'
  AND context = 'customer_unpaid_invoices'
  AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(report_config->'fields', '[]'::jsonb)) AS f
      WHERE f->>'table' = 'Invoice'
        AND f->>'field' = 'id'
  );
