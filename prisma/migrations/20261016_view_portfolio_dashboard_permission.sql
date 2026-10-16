-- ============================================================================
-- Migration Script: view_portfolio_dashboard permission + hide_portfolio_health
-- Generated: 2026-10-16
-- Context: Portfolio Health access split from view_credit_dashboard
-- ============================================================================
--
-- 1. Add Account.hide_portfolio_health (default false).
-- 2. Grant view_portfolio_dashboard to System_Administrator on master (10013),
--    then clone that grant to all other accounts (idempotent).
--    Do NOT copy-grant from existing view_credit_dashboard holders.
--
-- IMPORTANT NOTES:
-- 1. Prefer: npx prisma db execute --schema prisma/schema.prisma --file <this-file>
-- 2. Do NOT add top-level BEGIN;/COMMIT; (runner already wraps in a transaction)
-- 3. After schema changes, regenerate Prisma client: npx prisma generate
-- ============================================================================

ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS hide_portfolio_health boolean NOT NULL DEFAULT false;

INSERT INTO "RolePermission" (
    account_id,
    role,
    permission_key,
    is_collection,
    is_credit_insurance,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT
    10013 AS account_id,
    'System_Administrator'::user_role AS role,
    'view_portfolio_dashboard' AS permission_key,
    false AS is_collection,
    true AS is_credit_insurance,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
WHERE NOT EXISTS (
    SELECT 1 FROM "RolePermission" e
    WHERE e.account_id = 10013
      AND e.role = 'System_Administrator'::user_role
      AND e.permission_key = 'view_portfolio_dashboard'
)
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

INSERT INTO "RolePermission" (
    account_id,
    role,
    permission_key,
    is_collection,
    is_credit_insurance,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT
    a.id AS account_id,
    rp.role,
    rp.permission_key,
    rp.is_collection,
    rp.is_credit_insurance,
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
    AND a.deleted_at IS NULL
    AND rp.account_id = 10013
    AND rp.role = 'System_Administrator'::user_role
    AND rp.permission_key = 'view_portfolio_dashboard'
    AND NOT EXISTS (
        SELECT 1 FROM "RolePermission" e
        WHERE e.account_id = a.id
          AND e.role = rp.role
          AND e.permission_key = 'view_portfolio_dashboard'
    )
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

-- ============================================================================
-- Verification queries:
--
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'Account' AND column_name = 'hide_portfolio_health';
--
-- SELECT account_id, role, permission_key
-- FROM "RolePermission"
-- WHERE permission_key = 'view_portfolio_dashboard'
-- ORDER BY account_id, role;
-- ============================================================================
