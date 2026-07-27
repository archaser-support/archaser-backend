-- Migration: Add primary_color to Account table for per-account theming
-- Date: 2025-02-04
-- Description: Allows each account to set a custom primary color (hex #RRGGBB).
--              Null = use default purple (#6B46C1).

-- Add primary_color column (nullable, VARCHAR(7) for #RRGGBB)
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "primary_color" VARCHAR(7);

-- Add comment for documentation
COMMENT ON COLUMN "Account"."primary_color" IS 'Custom primary color in hex format (#RRGGBB). Null uses default theme color.';
