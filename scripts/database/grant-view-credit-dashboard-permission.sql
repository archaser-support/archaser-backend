-- Grant view_credit_dashboard to Credit Insurance–applicable roles on master account (10013), then clone to all accounts.
-- Idempotent: ON CONFLICT DO NOTHING / NOT EXISTS.
--
-- Uses only core RolePermission columns (compatible with DBs before add-credit-insurance-product-support.sql).
--
-- Run with: psql $DATABASE_URL -f scripts/database/grant-view-credit-dashboard-permission.sql

BEGIN;

INSERT INTO "RolePermission" (
    account_id,
    role,
    permission_key,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT
    10013 AS account_id,
    r.role::user_role AS role,
    'view_credit_dashboard' AS permission_key,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM
    (VALUES
        ('CFO'::text),
        ('Data_Analyst'::text),
        ('System_Administrator'::text)
    ) AS r(role)
WHERE NOT EXISTS (
    SELECT 1 FROM "RolePermission" e
    WHERE e.account_id = 10013
      AND e.role = r.role::user_role
      AND e.permission_key = 'view_credit_dashboard'
)
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

INSERT INTO "RolePermission" (
    account_id,
    role,
    permission_key,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT
    a.id AS account_id,
    rp.role,
    rp.permission_key,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM
    "Account" a
CROSS JOIN
    "RolePermission" rp
WHERE
    a.id != 10013
    AND rp.account_id = 10013
    AND rp.permission_key = 'view_credit_dashboard'
    AND NOT EXISTS (
        SELECT 1 FROM "RolePermission" e
        WHERE e.account_id = a.id
          AND e.role = rp.role
          AND e.permission_key = 'view_credit_dashboard'
    )
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

COMMIT;
