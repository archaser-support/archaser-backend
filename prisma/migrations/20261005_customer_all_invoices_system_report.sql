-- System report: All Invoices on the customer invoices tab
-- Context: customer_unpaid_invoices
-- unique_name: all_invoices
--
-- Seeded from account 10149 report "All Invoices" (id 5065), with is_system /
-- is_public so every account gets the same selector entry as Overdue Invoices.
-- Default view for this context (clears is_default on other views).
--
-- Do not wrap in top-level BEGIN/COMMIT (CI / prisma db execute already
-- run inside a transaction).

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
    'All Invoices' AS name,
    'all_invoices' AS unique_name,
    'All invoices' AS description,
    '{
        "joins": [],
        "fields": [
            {"field": "invoice_number", "table": "Invoice"},
            {"field": "invoice_date", "table": "Invoice"},
            {"field": "due_date", "table": "Invoice"},
            {"field": "amount", "table": "Invoice"},
            {"field": "customer_amount", "table": "Invoice"},
            {"field": "customer_currency", "table": "Invoice"},
            {"field": "total_paid", "table": "Invoice"},
            {"field": "credit_for_invoice_number", "table": "Invoice"},
            {"field": "status", "table": "Invoice"}
        ],
        "tables": ["Invoice"],
        "filters": [],
        "sorting": [
            {"field": "Invoice.invoice_number", "direction": "ASC"}
        ],
        "grouping": [],
        "columnOrder": [
            "Invoice.invoice_number",
            "Invoice.invoice_date",
            "Invoice.due_date",
            "Invoice.amount",
            "Invoice.customer_amount",
            "Invoice.customer_currency",
            "Invoice.total_paid",
            "Invoice.credit_for_invoice_number",
            "Invoice.status"
        ]
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

UPDATE "Report"
SET is_default = false,
    modified_at = NOW()
WHERE context = 'customer_unpaid_invoices'
  AND unique_name <> 'all_invoices'
  AND is_default = true;
