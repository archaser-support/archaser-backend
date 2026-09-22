-- Account include/exclude VAT setting (default include = true).
ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS "amounts_include_vat" BOOLEAN NOT NULL DEFAULT true;
