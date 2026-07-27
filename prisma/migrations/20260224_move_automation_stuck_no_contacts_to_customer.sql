-- Move automation_stuck_no_contacts from CustomerCollectionPeriod to Customer
-- Do NOT run without approval. Run with: psql $DATABASE_URL -f prisma/migrations/20260224_move_automation_stuck_no_contacts_to_customer.sql

-- 1. Add column to Customer (default false)
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "automation_stuck_no_contacts" BOOLEAN DEFAULT false;

-- 2. Backfill: set Customer.automation_stuck_no_contacts = true where customer has open period with flag set
UPDATE "Customer" c
SET automation_stuck_no_contacts = true
FROM "CustomerCollectionPeriod" p
WHERE p.customer_id = c.id
  AND p.period_end_date IS NULL
  AND p.automation_stuck_no_contacts = true;

-- 3. Drop index that includes automation_stuck_no_contacts on CustomerCollectionPeriod
DROP INDEX IF EXISTS "idx_customer_collection_period_activity_generation";

-- 4. Remove column from CustomerCollectionPeriod
ALTER TABLE "CustomerCollectionPeriod" DROP COLUMN IF EXISTS "automation_stuck_no_contacts";

-- 5. Recreate index without automation_stuck_no_contacts
CREATE INDEX "idx_customer_collection_period_activity_generation" ON "CustomerCollectionPeriod" ("period_end_date", "create_next_activity", "current_category", "customer_id");
