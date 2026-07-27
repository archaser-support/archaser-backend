-- Backfill limit_assessed_* (equivalent to scripts/backfill-invoice-limit-assessment.ts)
-- Optional: set account filter in candidates WHERE (account_id = N).

-- 1) Preview
WITH candidates AS (
  SELECT
    i.id,
    i.account_id,
    i.customer_id,
    i.policy_id,
    CASE
      WHEN i.outstanding_debt IS NOT NULL AND i.outstanding_debt <> 0
        THEN i.outstanding_debt::numeric
      WHEN i.customer_outstanding_debt IS NOT NULL AND i.customer_outstanding_debt <> 0
        THEN i.customer_outstanding_debt::numeric
      ELSE COALESCE(i.amount, 0)::numeric
    END AS outstanding_left
  FROM "Invoice" i
  WHERE i.limit_assessed_amount IS NULL
    AND i.policy_id IS NOT NULL
    AND i.status IN ('Due', 'Overdue')
),
with_policy AS (
  SELECT
    c.*,
    cp.approved_limit,
    cp.approved_limit_currency
  FROM candidates c
  INNER JOIN "CustomerPolicy" cp
    ON cp.customer_id = c.customer_id
   AND cp.is_active = true
  WHERE cp.approved_limit IS NOT NULL
),
fifo AS (
  SELECT
    wp.id,
    wp.account_id,
    wp.customer_id,
    wp.policy_id,
    wp.outstanding_left,
    wp.approved_limit,
    wp.approved_limit_currency,
    COALESCE(
      SUM(wp.outstanding_left) OVER (
        PARTITION BY wp.customer_id, wp.policy_id
        ORDER BY wp.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    ) AS open_ar_before,
    GREATEST(
      0,
      wp.approved_limit - COALESCE(
        SUM(wp.outstanding_left) OVER (
          PARTITION BY wp.customer_id, wp.policy_id
          ORDER BY wp.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),
        0
      )
    ) AS limit_assessed_amount_new
  FROM with_policy wp
)
SELECT *
FROM fifo
ORDER BY customer_id, policy_id, id;

-- 2) Apply (run this statement alone; comment out preview above if needed)
/*
WITH candidates AS (
  SELECT
    i.id,
    i.customer_id,
    i.policy_id,
    CASE
      WHEN i.outstanding_debt IS NOT NULL AND i.outstanding_debt <> 0
        THEN i.outstanding_debt::numeric
      WHEN i.customer_outstanding_debt IS NOT NULL AND i.customer_outstanding_debt <> 0
        THEN i.customer_outstanding_debt::numeric
      ELSE COALESCE(i.amount, 0)::numeric
    END AS outstanding_left
  FROM "Invoice" i
  WHERE i.limit_assessed_amount IS NULL
    AND i.policy_id IS NOT NULL
    AND i.status IN ('Due', 'Overdue')
),
with_policy AS (
  SELECT
    c.id,
    c.customer_id,
    c.policy_id,
    c.outstanding_left,
    cp.approved_limit,
    cp.approved_limit_currency
  FROM candidates c
  INNER JOIN "CustomerPolicy" cp
    ON cp.customer_id = c.customer_id
   AND cp.is_active = true
  WHERE cp.approved_limit IS NOT NULL
),
fifo AS (
  SELECT
    wp.id,
    wp.approved_limit_currency,
    GREATEST(
      0,
      wp.approved_limit - COALESCE(
        SUM(wp.outstanding_left) OVER (
          PARTITION BY wp.customer_id, wp.policy_id
          ORDER BY wp.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),
        0
      )
    ) AS limit_assessed_amount_new
  FROM with_policy wp
)
UPDATE "Invoice" inv
SET
  limit_assessed_amount = f.limit_assessed_amount_new,
  limit_assessed_at = NOW(),
  limit_assessed_currency = f.approved_limit_currency
FROM fifo f
WHERE inv.id = f.id;
*/
