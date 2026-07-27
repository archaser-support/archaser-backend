-- Grant billing connector permissions to archaser_admin on master account (10013), then clone to all accounts.
-- Idempotent: ON CONFLICT DO NOTHING / NOT EXISTS.
--
-- Run with: psql $DATABASE_URL -f scripts/database/grant-billing-connector-permissions.sql

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
    'archaser_admin'::user_role AS role,
    p.permission_key,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM
    (VALUES
        ('view_billing_connector'::text),
        ('manage_billing_connector'::text)
    ) AS p(permission_key)
WHERE NOT EXISTS (
    SELECT 1 FROM "RolePermission" e
    WHERE e.account_id = 10013
      AND e.role = 'archaser_admin'::user_role
      AND e.permission_key = p.permission_key
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
    AND rp.role = 'archaser_admin'::user_role
    AND rp.permission_key IN ('view_billing_connector', 'manage_billing_connector')
    AND NOT EXISTS (
        SELECT 1 FROM "RolePermission" e
        WHERE e.account_id = a.id
          AND e.role = rp.role
          AND e.permission_key = rp.permission_key
    )
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

COMMIT;
