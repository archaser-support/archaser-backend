-- Migration: Replace ContactStatus table with contact_status enum

-- 1. Create the new enum type
CREATE TYPE "contact_status" AS ENUM ('Active', 'Inactive');

-- 2. Prepare the Contact table for transition
-- Renaming the existing status column (integer) to status_old to preserve data
ALTER TABLE "Contact" RENAME COLUMN "status" TO "status_old";

-- 3. Add the new status column with the enum type
ALTER TABLE "Contact" ADD COLUMN "status" "contact_status" NOT NULL DEFAULT 'Active';

-- 4. Migrate existing data
-- Mapping integer values (1 = Active, 0 = Inactive) to enum labels
UPDATE "Contact" 
SET "status" = CASE 
    WHEN "status_old" = 1 THEN 'Active'::"contact_status" 
    ELSE 'Inactive'::"contact_status" 
END;

-- 5. Clean up
-- Remove the old status column
ALTER TABLE "Contact" DROP COLUMN "status_old";

-- Drop the redundant ContactStatus table if it exists
DROP TABLE IF EXISTS "ContactStatus";
