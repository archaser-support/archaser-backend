-- Grant update_insurance_policy to Credit Insurance–applicable roles on master account (10013), then clone to all accounts.
-- Idempotent: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING, WHERE NOT EXISTS.
--
-- IMPORTANT: Reload this file from disk before running. An older copy inserted into
-- is_collection / is_credit_insurance before those columns existed and caused SQLSTATE 42703.
--
-- Run with: psql "$DATABASE_URL" -f scripts/database/grant-update-insurance-policy-permission.sql

BEGIN;

-- Align RolePermission (and Account) with prisma/schema.prisma when the DB predates those columns.
ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS has_collection boolean NOT NULL DEFAULT true;

ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS has_credit_insurance boolean NOT NULL DEFAULT false;

ALTER TABLE "RolePermission"
ADD COLUMN IF NOT EXISTS is_collection boolean NOT NULL DEFAULT true;

ALTER TABLE "RolePermission"
ADD COLUMN IF NOT EXISTS is_credit_insurance boolean NOT NULL DEFAULT false;

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
    r.role::user_role AS role,
    'update_insurance_policy' AS permission_key,
    false AS is_collection,
    true AS is_credit_insurance,
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
      AND e.permission_key = 'update_insurance_policy'
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
    AND rp.account_id = 10013
    AND rp.permission_key = 'update_insurance_policy'
    AND NOT EXISTS (
        SELECT 1 FROM "RolePermission" e
        WHERE e.account_id = a.id
          AND e.role = rp.role
          AND e.permission_key = 'update_insurance_policy'
    )
ON CONFLICT (account_id, role, permission_key) DO NOTHING;

COMMIT;
