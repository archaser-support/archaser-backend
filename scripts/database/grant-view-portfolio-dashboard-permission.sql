-- Grant view_portfolio_dashboard to System_Administrator on master account (10013), then clone to all accounts.
-- Idempotent: ON CONFLICT DO NOTHING / NOT EXISTS.
-- Do NOT copy-grant from existing view_credit_dashboard holders.
--
-- Prefer the feature migration:
--   prisma/migrations/20261016_view_portfolio_dashboard_permission.sql
-- This companion mirrors that grant for ad-hoc / DBeaver runs.
--
-- Run with: npx prisma db execute --schema prisma/schema.prisma --file scripts/database/grant-view-portfolio-dashboard-permission.sql
-- Do NOT wrap in top-level BEGIN;/COMMIT;

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
