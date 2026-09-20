-- Backfill: active promises must show collection category Promise_to_pay.
-- Skips periods with any open dispute (Dispute wins).
-- Safe to re-run.
-- DB enum value is 'Promise to pay' (Prisma: Promise_to_pay).

BEGIN;

CREATE TEMP TABLE _open_ptp_category_targets ON COMMIT DROP AS
SELECT
    ccp.id AS collection_period_id,
    ccp.customer_id,
    ccp.current_category::text AS old_category,
    c.account_id
FROM "CustomerCollectionPeriod" ccp
INNER JOIN "Customer" c ON c.id = ccp.customer_id
WHERE ccp.period_end_date IS NULL
  AND ccp.promise_to_pay_date IS NOT NULL
  AND ccp.promise_to_pay_date > NOW() - INTERVAL '24 hours'
  AND ccp.current_category IS DISTINCT FROM 'Promise to pay'::category
  AND NOT EXISTS (
      SELECT 1
      FROM "CustomerDispute" d
      WHERE d.customer_id = ccp.customer_id
        AND d.dispute_status NOT IN ('Resolved', 'Cancelled')
  );

UPDATE "CustomerCollectionPeriod" ccp
SET
    previous_category = ccp.current_category,
    current_category = 'Promise to pay'::category,
    next_category = NULL,
    next_category_date = NULL,
    modified_at = NOW()
FROM _open_ptp_category_targets t
WHERE ccp.id = t.collection_period_id;

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
        'customers.values.category_promise_to_pay',
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
FROM _open_ptp_category_targets t;

COMMIT;
