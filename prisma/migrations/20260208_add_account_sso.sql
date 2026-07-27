-- Add SSO support to Account table
-- Part of SSO implementation: per-account SSO configuration

-- Add sso_enabled and sso_providers columns
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "sso_enabled" BOOLEAN DEFAULT FALSE;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "sso_providers" VARCHAR(100);

-- Add index on sub_domain for efficient account lookup during login
CREATE INDEX IF NOT EXISTS "idx_account_sub_domain" ON "Account"("sub_domain");
