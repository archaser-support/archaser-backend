BEGIN;

ALTER TABLE "BillingConnector"
ADD COLUMN IF NOT EXISTS "extension_key" VARCHAR(100);

ALTER TABLE "BillingConnector"
ADD COLUMN IF NOT EXISTS "extension_config" JSONB;

COMMIT;
