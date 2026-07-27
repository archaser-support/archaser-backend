-- Migration: Add secondary_color to Account table for per-account theming
-- Date: 2025-02-04
-- Description: Allows each account to set a custom secondary color (hex #RRGGBB).
--              Null = use default gray (#4A5568).

-- Add secondary_color column (nullable, VARCHAR(7) for #RRGGBB)
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "secondary_color" VARCHAR(7);

-- Add comment for documentation
COMMENT ON COLUMN "Account"."secondary_color" IS 'Custom secondary color in hex format (#RRGGBB). Null uses default theme color.';
