-- Migration: Add chart_palette_color to Account table for per-account chart theming
-- Date: 2025-02-06
-- Description: Allows each account to set a custom chart palette color (hex #RRGGBB).
--              Null = use default (#E53E3E). Used for charts and card icons.

-- Add chart_palette_color column (nullable, VARCHAR(7) for #RRGGBB)
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "chart_palette_color" VARCHAR(7);

-- Add comment for documentation
COMMENT ON COLUMN "Account"."chart_palette_color" IS 'Custom chart palette color in hex format (#RRGGBB). Null uses default. Used for charts and card icons.';
