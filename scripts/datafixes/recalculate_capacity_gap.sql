-- ============================================================================
-- DATAFIX: Recalculate capacity gap and uninsured amounts for CustomerPolicy rows
--
-- Date:    2026-06-07
-- Description: Recalculate CP.capacity_gap_amount and CP.uninsured_amount based on
--              converting cp.approved_limit to account base currency using the
--              latest exchange rate from "CurrencyRate". It also recalculates
--              capacity_gap_amount1/uninsured_amount1 in the policy currency.
-- ============================================================================

WITH LatestRates AS (
  -- Get the latest rate for each currency pair from CurrencyRate table
  SELECT DISTINCT ON (base_currency, other_currency)
    base_currency,
    other_currency,
    currency_ratio,
    rate_date
  FROM "CurrencyRate"
  ORDER BY base_currency, other_currency, rate_date DESC
),
CustomerARBase AS (
  -- Calculate total open AR in base currency per customer
  SELECT
    customer_id,
    COALESCE(SUM(
      CASE
        WHEN COALESCE(outstanding_debt, 0) != 0 THEN outstanding_debt
        ELSE COALESCE(customer_outstanding_debt, 0)
      END
    ), 0) AS total_ar_base
  FROM "Invoice"
  WHERE status IN ('Due', 'Overdue')
  GROUP BY customer_id
),
CustomerARByPolicyCurrency AS (
  -- Calculate open AR in the policy currency per customer/policy currency
  SELECT
    i.customer_id,
    UPPER(COALESCE(i.customer_currency, '')) AS invoice_currency,
    COALESCE(SUM(
      CASE
        WHEN COALESCE(i.customer_outstanding_debt, 0) != 0 THEN i.customer_outstanding_debt
        ELSE COALESCE(i.amount, 0)
      END
    ), 0) AS total_ar_policy_curr
  FROM "Invoice" i
  WHERE i.status IN ('Due', 'Overdue')
  GROUP BY i.customer_id, UPPER(COALESCE(i.customer_currency, ''))
),
CalculatedGaps AS (
  -- Compute correct approved limit in account currency and aggregate open ARs
  SELECT
    cp.id AS policy_row_id,
    cp.approved_limit,
    cp.approved_limit_currency,
    cp.outdated_dcl,
    a.currency AS account_currency,
    COALESCE(arb.total_ar_base, 0) AS total_ar_base,
    
    -- Convert approved limit to account currency using LatestRates
    CASE
      WHEN UPPER(COALESCE(cp.approved_limit_currency, '')) = UPPER(COALESCE(a.currency, '')) THEN cp.approved_limit
      ELSE
        COALESCE(
          (
            SELECT cp.approved_limit / r.currency_ratio
            FROM LatestRates r
            WHERE UPPER(r.base_currency) = UPPER(a.currency)
              AND UPPER(r.other_currency) = UPPER(cp.approved_limit_currency)
          ),
          (
            SELECT cp.approved_limit * r.currency_ratio
            FROM LatestRates r
            WHERE UPPER(r.base_currency) = UPPER(cp.approved_limit_currency)
              AND UPPER(r.other_currency) = UPPER(a.currency)
          ),
          cp.approved_limit -- fallback if no rate found
        )
    END AS approved_limit_base,
    
    COALESCE(arpc.total_ar_policy_curr, 0) AS total_ar_policy_curr,
    arpc.invoice_currency
  FROM "CustomerPolicy" cp
  INNER JOIN "Customer" c ON c.id = cp.customer_id
  INNER JOIN "Account" a ON a.id = c.account_id
  LEFT JOIN CustomerARBase arb ON arb.customer_id = cp.customer_id
  LEFT JOIN CustomerARByPolicyCurrency arpc ON arpc.customer_id = cp.customer_id
    AND arpc.invoice_currency = UPPER(COALESCE(cp.approved_limit_currency, ''))
)
UPDATE "CustomerPolicy" cp
SET
  -- 1. Base capacity gap and uninsured amounts
  uninsured_amount = CASE
    WHEN cp.approved_limit IS NULL OR cp.outdated_dcl = true THEN 0
    WHEN UPPER(COALESCE(cp.approved_limit_currency, '')) = UPPER(COALESCE(cg.account_currency, '')) THEN
      cg.total_ar_base - cp.approved_limit
    WHEN cg.invoice_currency = UPPER(COALESCE(cp.approved_limit_currency, '')) THEN
      -- Convert policy uninsured amount to base currency
      COALESCE(
        (
          SELECT (cg.total_ar_policy_curr - cp.approved_limit) / r.currency_ratio
          FROM LatestRates r
          WHERE UPPER(r.base_currency) = UPPER(cg.account_currency)
            AND UPPER(r.other_currency) = UPPER(cp.approved_limit_currency)
        ),
        (
          SELECT (cg.total_ar_policy_curr - cp.approved_limit) * r.currency_ratio
          FROM LatestRates r
          WHERE UPPER(r.base_currency) = UPPER(cp.approved_limit_currency)
            AND UPPER(r.other_currency) = UPPER(cg.account_currency)
        ),
        cg.total_ar_base - COALESCE(cg.approved_limit_base, 0) -- fallback
      )
    ELSE
      cg.total_ar_base - COALESCE(cg.approved_limit_base, 0)
  END,
  capacity_gap_amount = CASE
    WHEN cp.approved_limit IS NULL OR cp.outdated_dcl = true THEN 0
    WHEN UPPER(COALESCE(cp.approved_limit_currency, '')) = UPPER(COALESCE(cg.account_currency, '')) THEN
      GREATEST(0, cg.total_ar_base - cp.approved_limit)
    WHEN cg.invoice_currency = UPPER(COALESCE(cp.approved_limit_currency, '')) THEN
      -- Convert policy capacity gap to base currency
      COALESCE(
        (
          SELECT GREATEST(0, cg.total_ar_policy_curr - cp.approved_limit) / r.currency_ratio
          FROM LatestRates r
          WHERE UPPER(r.base_currency) = UPPER(cg.account_currency)
            AND UPPER(r.other_currency) = UPPER(cp.approved_limit_currency)
        ),
        (
          SELECT GREATEST(0, cg.total_ar_policy_curr - cp.approved_limit) * r.currency_ratio
          FROM LatestRates r
          WHERE UPPER(r.base_currency) = UPPER(cp.approved_limit_currency)
            AND UPPER(r.other_currency) = UPPER(cg.account_currency)
        ),
        GREATEST(0, cg.total_ar_base - COALESCE(cg.approved_limit_base, 0)) -- fallback
      )
    ELSE
      GREATEST(0, cg.total_ar_base - COALESCE(cg.approved_limit_base, 0))
  END,
  
  -- 2. Policy currency capacity gap and uninsured amounts
  uninsured_amount1 = CASE 
    WHEN cp.approved_limit IS NOT NULL AND cp.approved_limit_currency IS NOT NULL AND cp.outdated_dcl = false THEN
      cg.total_ar_policy_curr - cp.approved_limit
    ELSE 0
  END,
  capacity_gap_amount1 = CASE
    WHEN cp.approved_limit IS NOT NULL AND cp.approved_limit_currency IS NOT NULL AND cp.outdated_dcl = false THEN
      GREATEST(0, cg.total_ar_policy_curr - cp.approved_limit)
    ELSE 0
  END,
  capacity_gap_currency1 = CASE
    WHEN cp.approved_limit IS NOT NULL AND cp.approved_limit_currency IS NOT NULL AND cp.outdated_dcl = false THEN
      cp.approved_limit_currency
    ELSE NULL
  END
FROM CalculatedGaps cg
WHERE cp.id = cg.policy_row_id;
