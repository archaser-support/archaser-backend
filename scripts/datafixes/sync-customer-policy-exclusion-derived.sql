-- Reconcile legacy customer_policy exclusion state.
-- Reason is source of truth; excluded_from_policy is derived.
UPDATE "customer_policy"
SET "policy_exclusion_reason" = NULL
WHERE "policy_exclusion_reason" IS NOT NULL
  AND BTRIM("policy_exclusion_reason") = '';

UPDATE "customer_policy"
SET "excluded_from_policy" = CASE
    WHEN "policy_exclusion_reason" IS NULL THEN FALSE
    WHEN BTRIM("policy_exclusion_reason") = '' THEN FALSE
    ELSE TRUE
END
WHERE "excluded_from_policy" IS DISTINCT FROM CASE
    WHEN "policy_exclusion_reason" IS NULL THEN FALSE
    WHEN BTRIM("policy_exclusion_reason") = '' THEN FALSE
    ELSE TRUE
END;
