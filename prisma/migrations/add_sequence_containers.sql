-- Migration: Add SequenceContainer model and migrate existing sequences
-- This migration adds support for multiple named sequences per category

-- Create SequenceContainer table
CREATE TABLE "SequenceContainer" (
    "id" SERIAL PRIMARY KEY,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "name" VARCHAR(255) NOT NULL,
    "category" "category" NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- Add sequence_container_id to ActivitiesSequence table
ALTER TABLE "ActivitiesSequence" ADD COLUMN "sequence_container_id" INTEGER;

-- Add foreign key constraints
ALTER TABLE "SequenceContainer" ADD CONSTRAINT "SequenceContainer_customer_id_fkey" 
    FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivitiesSequence" ADD CONSTRAINT "ActivitiesSequence_sequence_container_id_fkey" 
    FOREIGN KEY ("sequence_container_id") REFERENCES "SequenceContainer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add unique constraint for sequence container names per customer/category
ALTER TABLE "SequenceContainer" ADD CONSTRAINT "sequence_container_unique_name" 
    UNIQUE ("customer_id", "category", "name");

-- Add indexes for performance
CREATE INDEX "sequence_container_default" ON "SequenceContainer"("customer_id", "category", "is_default");
CREATE INDEX "sequence_container_customer_category" ON "SequenceContainer"("customer_id", "category");

-- Migrate existing sequences to sequence containers
-- For each customer and category combination, create a default sequence container
INSERT INTO "SequenceContainer" ("name", "category", "customer_id", "is_default", "active", "created_at", "modified_at")
SELECT DISTINCT 
    CASE 
        WHEN "category" = 'Automated' THEN 'Automated Sequence'
        WHEN "category" = 'Promise to pay' THEN 'Promise to Pay Sequence'
        WHEN "category" = 'Dispute' THEN 'Dispute Sequence'
        WHEN "category" = 'Agent' THEN 'Agent Sequence'
        WHEN "category" = 'Legal' THEN 'Legal Sequence'
        ELSE 'Default Sequence'
    END as "name",
    "category",
    "customer_id",
    true as "is_default",
    true as "active",
    MIN("created_at") as "created_at",
    NOW() as "modified_at"
FROM "ActivitiesSequence"
WHERE "master_template" = false
GROUP BY "customer_id", "category";

-- Update ActivitiesSequence records to link to their sequence containers
UPDATE "ActivitiesSequence" 
SET "sequence_container_id" = sc."id"
FROM "SequenceContainer" sc
WHERE "ActivitiesSequence"."customer_id" = sc."customer_id" 
  AND "ActivitiesSequence"."category" = sc."category"
  AND "ActivitiesSequence"."master_template" = false;

-- Add trigger to update modified_at timestamp
CREATE OR REPLACE FUNCTION update_modified_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.modified_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_sequence_container_modified_at 
    BEFORE UPDATE ON "SequenceContainer" 
    FOR EACH ROW EXECUTE FUNCTION update_modified_at_column();

-- Add comments for documentation
COMMENT ON TABLE "SequenceContainer" IS 'Container for grouping activity sequences by name and category';
COMMENT ON COLUMN "SequenceContainer"."name" IS 'User-friendly name for the sequence (e.g., "Standard Collection", "Gentle Follow-up")';
COMMENT ON COLUMN "SequenceContainer"."category" IS 'Category of activities in this sequence (Automated, Promise_to_pay, Dispute, Agent, Legal)';
COMMENT ON COLUMN "SequenceContainer"."is_default" IS 'Whether this is the default sequence for its category (only one per category per customer)';
COMMENT ON COLUMN "SequenceContainer"."active" IS 'Whether this sequence can be selected (inactive sequences are hidden)';
COMMENT ON COLUMN "ActivitiesSequence"."sequence_container_id" IS 'Reference to the sequence container this step belongs to';
