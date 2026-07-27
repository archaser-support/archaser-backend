-- Migration: Add email engagement tracking fields to ActivityContact table
-- Date: 2025-01-22
-- Description: Adds fields to track email opens and clicks for better engagement analytics

-- Add email engagement tracking fields
ALTER TABLE "ActivityContact" 
ADD COLUMN email_opened_at TIMESTAMPTZ(6),
ADD COLUMN email_clicked_at TIMESTAMPTZ(6),
ADD COLUMN email_open_count INTEGER DEFAULT 0,
ADD COLUMN email_click_count INTEGER DEFAULT 0;

-- Add comments to document the new fields
COMMENT ON COLUMN "ActivityContact".email_opened_at IS 'Timestamp when the email was first opened';
COMMENT ON COLUMN "ActivityContact".email_clicked_at IS 'Timestamp when the email was first clicked';
COMMENT ON COLUMN "ActivityContact".email_open_count IS 'Total number of times the email was opened';
COMMENT ON COLUMN "ActivityContact".email_click_count IS 'Total number of times links in the email were clicked';

-- Create indexes for better query performance
CREATE INDEX idx_activity_contact_email_opened_at ON "ActivityContact"(email_opened_at);
CREATE INDEX idx_activity_contact_email_clicked_at ON "ActivityContact"(email_clicked_at);
CREATE INDEX idx_activity_contact_email_engagement ON "ActivityContact"(email_open_count, email_click_count); 