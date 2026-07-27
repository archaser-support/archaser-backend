ALTER TABLE "Customer"
ADD COLUMN IF NOT EXISTS "active_customer_since" DATE;

ALTER TABLE "Customer"
ADD COLUMN IF NOT EXISTS "outdated_dcl" BOOLEAN NOT NULL DEFAULT false;
