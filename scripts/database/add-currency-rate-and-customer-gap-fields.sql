-- Currency rate table + customer currency gap fields

BEGIN;

CREATE TABLE IF NOT EXISTS "CurrencyRate" (
  "id" SERIAL PRIMARY KEY,
  "rate_date" DATE NOT NULL,
  "base_currency" VARCHAR(16) NOT NULL,
  "other_currency" VARCHAR(16) NOT NULL,
  "currency_ratio" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "created_by" VARCHAR,
  "modified_by" VARCHAR
);

CREATE UNIQUE INDEX IF NOT EXISTS "CurrencyRate_rate_date_base_currency_other_currency_key"
  ON "CurrencyRate" ("rate_date", "base_currency", "other_currency");

CREATE INDEX IF NOT EXISTS "CurrencyRate_rate_date_base_currency_idx"
  ON "CurrencyRate" ("rate_date", "base_currency");

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "approved_limit_currency" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "gap_in_base_currency" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "gap_in_base_currency_date" DATE;

COMMIT;
