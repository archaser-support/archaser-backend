-- Due / Overdue system reports omit Invoice.status. The customer invoice grid
-- gates Ignore for MEP on status, so add it (hidden from columnOrder) so those
-- actions can resolve Due vs Overdue rows.
--
-- Do not wrap in top-level BEGIN/COMMIT (CI / prisma db execute already
-- run inside a transaction).

UPDATE "Report"
SET
    report_config = jsonb_set(
        report_config,
        '{fields}',
        '[{"field": "status", "table": "Invoice"}]'::jsonb
            || COALESCE(report_config->'fields', '[]'::jsonb)
    ),
    modified_at = NOW()
WHERE unique_name IN ('due_invoices', 'overdue_invoices')
  AND context = 'customer_unpaid_invoices'
  AND is_system = true
  AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(report_config->'fields', '[]'::jsonb)) AS f
      WHERE f->>'table' = 'Invoice'
        AND f->>'field' = 'status'
  );
