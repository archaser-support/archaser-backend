-- SQL script to add report permissions to all users (via roles)
-- This script:
-- 1. Adds report permissions to all roles for master account (10013)
-- 2. Clones report permissions from master account to all other accounts
--
-- Report permissions added:
--   - view_reports
--   - create_report
--   - edit_report
--   - delete_report
--   - share_report
--   - schedule_report
--   - export_report
--
-- Run with: psql $DATABASE_URL -f scripts/database/add-report-permissions-to-all-users.sql

BEGIN;

-- Step 1: Add report permissions to all roles for master account (10013)
-- This will add permissions only if they don't already exist (ON CONFLICT DO NOTHING)

INSERT INTO "RolePermission" (account_id, role, permission_key, created_at, modified_at, created_by, modified_by)
SELECT 
    10013 as account_id,
    r.role::user_role as role,
    p.permission_key,
    NOW() as created_at,
    NOW() as modified_at,
    NULL as created_by,
    NULL as modified_by
FROM 
    (SELECT DISTINCT role FROM "RolePermission" WHERE account_id = 10013) r
CROSS JOIN 
    (VALUES 
        ('view_reports'),
        ('create_report'),
        ('edit_report'),
        ('delete_report'),
        ('share_report'),
        ('schedule_report'),
        ('export_report')
    ) AS p(permission_key)
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

-- Step 2: Clone report permissions from master account to all other accounts
-- This ensures all accounts have the same report permissions for their roles

INSERT INTO "RolePermission" (account_id, role, permission_key, created_at, modified_at, created_by, modified_by)
SELECT 
    a.id as account_id,
    rp.role,
    rp.permission_key,
    NOW() as created_at,
    NOW() as modified_at,
    NULL as created_by,
    NULL as modified_by
FROM 
    "Account" a
CROSS JOIN 
    "RolePermission" rp
WHERE 
    a.id != 10013  -- Exclude master account (already done in Step 1)
    AND rp.account_id = 10013  -- Only master account permissions
    AND rp.permission_key IN (
        'view_reports',
        'create_report',
        'edit_report',
        'delete_report',
        'share_report',
        'schedule_report',
        'export_report'
    )  -- Only report permissions
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

COMMIT;

-- Summary query - Show report permissions by role and account
SELECT 
    'Report Permissions Summary' as summary,
    role,
    account_id,
    COUNT(*) as report_permissions_count,
    STRING_AGG(permission_key, ', ' ORDER BY permission_key) as permissions_list
FROM "RolePermission"
WHERE permission_key IN (
    'view_reports',
    'create_report',
    'edit_report',
    'delete_report',
    'share_report',
    'schedule_report',
    'export_report'
)
GROUP BY role, account_id
ORDER BY role, account_id;

-- Summary by account
SELECT 
    'Report Permissions by Account' as summary,
    account_id,
    COUNT(DISTINCT role) as roles_with_report_permissions,
    COUNT(*) as total_report_permissions
FROM "RolePermission"
WHERE permission_key IN (
    'view_reports',
    'create_report',
    'edit_report',
    'delete_report',
    'share_report',
    'schedule_report',
    'export_report'
)
GROUP BY account_id
ORDER BY account_id;


