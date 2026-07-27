-- Add master_template column to SequenceContainer table
ALTER TABLE "SequenceContainer" ADD COLUMN "master_template" BOOLEAN NOT NULL DEFAULT false;

-- Create index on master_template for query performance
CREATE INDEX "sequence_container_master_template" ON "SequenceContainer"("master_template");

-- Update existing sequence containers for customer 10013 to be master templates
UPDATE "SequenceContainer" 
SET "master_template" = true 
WHERE "customer_id" = 10013 AND "active" = true;

-- Verify the update
SELECT 
    id, 
    name, 
    category, 
    customer_id, 
    active, 
    master_template,
    is_default
FROM "SequenceContainer" 
WHERE "customer_id" = 10013 
ORDER BY category, name;




