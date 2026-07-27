ALTER TABLE "InsurancePolicy"
ADD COLUMN IF NOT EXISTS "max_total_dcl_sdl_cover" DECIMAL(20, 4);
