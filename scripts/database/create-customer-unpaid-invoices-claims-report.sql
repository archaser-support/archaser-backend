-- ============================================================================
-- System report: unpaid invoices connected to claims
-- Context: customer_unpaid_invoices
-- unique_name contains credit_insurance so non-credit accounts hide it
--
-- Filters: Invoice.status in (Due, Overdue) + linked Claim exists
-- (no outstanding > 0 — see claims grill D8)
--
-- Run: npx prisma db execute --schema prisma/schema.prisma \
--   --file scripts/database/create-customer-unpaid-invoices-claims-report.sql
-- ============================================================================

BEGIN;

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
    'Invoices with Claims' AS name,
    'customer_unpaid_invoices_credit_insurance_claims' AS unique_name,
    'Due and Overdue invoices that have a credit insurance claim' AS description,
    '{
        "tables": ["Invoice", "Claim"],
        "fields": [
            {"table": "Invoice", "field": "invoice_number"},
            {"table": "Invoice", "field": "status"},
            {"table": "Invoice", "field": "due_date"},
            {"table": "Invoice", "field": "customer_outstanding_debt"},
            {"table": "Claim", "field": "status"},
            {"table": "Claim", "field": "recognized_loss"},
            {"table": "Claim", "field": "submission_date"},
            {"table": "Claim", "field": "insurer_submission_reference"}
        ],
        "filters": [
            {
                "table": "Invoice",
                "field": "status",
                "operator": "in",
                "value": ["Due", "Overdue"]
            },
            {
                "table": "Claim",
                "field": "invoice_id",
                "operator": "is_not_empty",
                "value": null
            }
        ],
        "sorting": [
            {"field": "invoice_number", "direction": "DESC"}
        ],
        "grouping": []
    }'::jsonb AS report_config,
    true AS is_public,
    true AS is_system,
    false AS is_default,
    'customer_unpaid_invoices' AS context,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM
    "Account" a
WHERE
    a.deleted_at IS NULL
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

COMMIT;
