-- One-time backfill: set Invoice.policy_id on open Due/Overdue invoices where policy_id IS NULL.
-- Prefers the CustomerPolicy row active at invoice_date (fallback: due_date), else current active policy.
-- Review rows where multiple policy windows match before running in production.

BEGIN;

WITH open_invoices AS (
    SELECT
        i.id AS invoice_id,
        i.customer_id,
        COALESCE(i.invoice_date, i.due_date, i.created_at) AS anchor_date
    FROM "Invoice" i
    WHERE i.policy_id IS NULL
      AND i.status IN ('Due', 'Overdue')
),
matched AS (
    SELECT DISTINCT ON (oi.invoice_id)
        oi.invoice_id,
        cp.insurance_policy_id
    FROM open_invoices oi
    INNER JOIN "CustomerPolicy" cp
        ON cp.customer_id = oi.customer_id
       AND cp.insurance_policy_id IS NOT NULL
    WHERE oi.anchor_date >= cp.created_at
      AND (cp.is_active = true OR oi.anchor_date < cp.modified_at)
    ORDER BY
        oi.invoice_id,
        cp.is_active DESC,
        cp.modified_at DESC,
        cp.id DESC
),
fallback AS (
    SELECT DISTINCT ON (oi.invoice_id)
        oi.invoice_id,
        cp.insurance_policy_id
    FROM open_invoices oi
    INNER JOIN "CustomerPolicy" cp
        ON cp.customer_id = oi.customer_id
       AND cp.is_active = true
       AND cp.insurance_policy_id IS NOT NULL
    WHERE NOT EXISTS (SELECT 1 FROM matched m WHERE m.invoice_id = oi.invoice_id)
    ORDER BY oi.invoice_id, cp.id DESC
),
resolved AS (
    SELECT invoice_id, insurance_policy_id FROM matched
    UNION ALL
    SELECT invoice_id, insurance_policy_id FROM fallback
)
UPDATE "Invoice" i
SET policy_id = r.insurance_policy_id
FROM resolved r
WHERE i.id = r.invoice_id
  AND i.policy_id IS NULL;

COMMIT;
