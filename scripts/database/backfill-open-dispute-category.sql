-- Backfill: open disputes must show collection category Dispute.
-- Safe to re-run. Only touches open periods whose category is not already Dispute
-- and that have at least one non-Resolved/Cancelled dispute.

BEGIN;

CREATE TEMP TABLE _open_dispute_category_targets ON COMMIT DROP AS
SELECT
    ccp.id AS collection_period_id,
    ccp.customer_id,
    ccp.current_category::text AS old_category,
    c.account_id
FROM "CustomerCollectionPeriod" ccp
INNER JOIN "Customer" c ON c.id = ccp.customer_id
WHERE ccp.period_end_date IS NULL
  AND ccp.current_category IS DISTINCT FROM 'Dispute'
  AND EXISTS (
      SELECT 1
      FROM "CustomerDispute" d
      WHERE d.customer_id = ccp.customer_id
        AND d.dispute_status NOT IN ('Resolved', 'Cancelled')
  );

UPDATE "CustomerCollectionPeriod" ccp
SET
    previous_category = ccp.current_category,
    current_category = 'Dispute',
    next_category = NULL,
    next_category_date = NULL,
    modified_at = NOW()
FROM _open_dispute_category_targets t
WHERE ccp.id = t.collection_period_id;

-- Timeline activity so agents see the corrective category change.
INSERT INTO "Activity" (
    customer_id,
    account_id,
    collection_period_id,
    type,
    title,
    title_params,
    content,
    schedule_time,
    actual_delivery_time,
    status,
    system_generated,
    created_at,
    modified_at
)
SELECT
    t.customer_id,
    t.account_id,
    t.collection_period_id,
    'Internal',
    '{{activities.fields.category_change}}',
    jsonb_build_object(
        'oldCategory',
        'customers.values.category_' || lower(replace(t.old_category, ' ', '_')),
        'newCategory',
        'customers.values.category_dispute',
        'userId',
        'system'
    ),
    '',
    NOW(),
    NOW(),
    'COMPLETED',
    true,
    NOW(),
    NOW()
FROM _open_dispute_category_targets t;

COMMIT;
