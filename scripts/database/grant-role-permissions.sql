-- Grant "View Users" (view_users) permission to all roles across all accounts.
-- Ensure "Collection Agent" role has Assign Dispute and Resolve Dispute permissions.
-- Idempotent: ON CONFLICT DO NOTHING and WHERE NOT EXISTS.
--
-- Steps:
-- 1. Add view_users to every role that exists for master account (10013).
-- 2. Clone view_users from master to all other accounts (same role set).
-- 3. Add assign_dispute and resolve_dispute to Collection_Agent for master account (10013).
-- 4. Clone assign_dispute and resolve_dispute for Collection_Agent from master to all other accounts.
--
-- Run with: psql $DATABASE_URL -f scripts/database/grant-role-permissions.sql

BEGIN;

-- Step 1: Add view_users to all roles for master account (10013) that don't already have it
INSERT INTO "RolePermission" (account_id, role, permission_key, created_at, modified_at, created_by, modified_by)
SELECT
    10013 AS account_id,
    r.role::user_role AS role,
    'view_users' AS permission_key,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM
    (SELECT DISTINCT role FROM "RolePermission" WHERE account_id = 10013) r
WHERE NOT EXISTS (
    SELECT 1 FROM "RolePermission" e
    WHERE e.account_id = 10013 AND e.role = r.role AND e.permission_key = 'view_users'
)
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

-- Step 2: Clone view_users from master to all other accounts (only where not already present)
INSERT INTO "RolePermission" (account_id, role, permission_key, created_at, modified_at, created_by, modified_by)
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
    AND rp.permission_key = 'view_users'
    AND NOT EXISTS (
        SELECT 1 FROM "RolePermission" e
        WHERE e.account_id = a.id AND e.role = rp.role AND e.permission_key = 'view_users'
    )
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

-- Step 3: Add assign_dispute and resolve_dispute to Collection_Agent (role value "Collection_Agent") for master account (10013) where not already present
INSERT INTO "RolePermission" (account_id, role, permission_key, created_at, modified_at, created_by, modified_by)
SELECT
    10013 AS account_id,
    'Collection_Agent'::user_role AS role,
    p.permission_key,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM
    (VALUES ('assign_dispute'), ('resolve_dispute')) AS p(permission_key)
WHERE NOT EXISTS (
    SELECT 1 FROM "RolePermission" e
    WHERE e.account_id = 10013 AND e.role = 'Collection_Agent'::user_role AND e.permission_key = p.permission_key
)
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

-- Step 4: Clone assign_dispute and resolve_dispute for Collection_Agent from master to all other accounts (only where not already present)
INSERT INTO "RolePermission" (account_id, role, permission_key, created_at, modified_at, created_by, modified_by)
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
    AND rp.role = 'Collection_Agent'::user_role
    AND rp.permission_key IN ('assign_dispute', 'resolve_dispute')
    AND NOT EXISTS (
        SELECT 1 FROM "RolePermission" e
        WHERE e.account_id = a.id AND e.role = rp.role AND e.permission_key = rp.permission_key
    )
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

COMMIT;
