-- Grant view_follow_up_reminders permission to Collection_Agent and Collection_Manager on all accounts.
-- Idempotent: ON CONFLICT DO NOTHING.
--
-- Run with: psql $DATABASE_URL -f scripts/database/grant-view-follow-up-reminders-permission.sql

BEGIN;

INSERT INTO "RolePermission" (account_id, role, permission_key, created_at, modified_at, created_by, modified_by)
SELECT
    a.id AS account_id,
    r.role::user_role AS role,
    'view_follow_up_reminders' AS permission_key,
    NOW() AS created_at,
    NOW() AS modified_at,
    NULL AS created_by,
    NULL AS modified_by
FROM
    "Account" a
CROSS JOIN (
    VALUES
        ('Collection_Agent'::text),
        ('Collection_Manager'::text)
) AS r(role)
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

COMMIT;
