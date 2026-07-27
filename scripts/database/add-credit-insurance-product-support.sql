-- Same DDL + backfills as section 0 of prisma/migrations/20260412_credit_insurance_product.sql.
-- Use this file alone if you already ran the rest of that migration without Account/RolePermission flags.

BEGIN;

-- 1) Account product flags (defaults preserve existing Collection behavior)
ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS has_collection boolean NOT NULL DEFAULT true;

ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS has_credit_insurance boolean NOT NULL DEFAULT false;

-- 2) RolePermission product applicability checkboxes
ALTER TABLE "RolePermission"
ADD COLUMN IF NOT EXISTS is_collection boolean NOT NULL DEFAULT true;

ALTER TABLE "RolePermission"
ADD COLUMN IF NOT EXISTS is_credit_insurance boolean NOT NULL DEFAULT false;

-- 3) Backfill all existing accounts as Collection-enabled, Credit-disabled
UPDATE "Account"
SET has_collection = true
WHERE has_collection IS DISTINCT FROM true;

UPDATE "Account"
SET has_credit_insurance = false
WHERE has_credit_insurance IS DISTINCT FROM false;

-- 4) Reset all existing role permissions to Collection-only baseline
UPDATE "RolePermission"
SET is_collection = true,
    is_credit_insurance = false
WHERE is_collection IS DISTINCT FROM true
   OR is_credit_insurance IS DISTINCT FROM false;

-- 5) Enable Credit Insurance only for mapped roles
UPDATE "RolePermission"
SET is_credit_insurance = true
WHERE role IN (
    'CFO',
    'Data_Analyst',
    'System_Administrator'
)
  AND is_credit_insurance IS DISTINCT FROM true;

COMMIT;
