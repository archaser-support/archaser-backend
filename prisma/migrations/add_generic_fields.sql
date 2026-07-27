-- Migration: Add generic fields to Customer, Contact, Invoice, Payment and generic_field_config to Account
-- Date: 2025-02-06
-- Description: Adds 6 configurable generic fields (2 text, 2 number, 2 date) per entity
--              with account-level config for enable/rename/read_only.

BEGIN;

-- Add generic_field_config to Account
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "generic_field_config" JSONB;

-- Add generic fields to Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "generic_text1" VARCHAR;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "generic_text2" VARCHAR;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "generic_number1" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "generic_number2" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "generic_date1" DATE;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "generic_date2" DATE;

-- Add generic fields to Contact
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "generic_text1" VARCHAR;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "generic_text2" VARCHAR;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "generic_number1" DOUBLE PRECISION;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "generic_number2" DOUBLE PRECISION;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "generic_date1" DATE;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "generic_date2" DATE;

-- Add generic fields to Invoice
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "generic_text1" VARCHAR;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "generic_text2" VARCHAR;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "generic_number1" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "generic_number2" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "generic_date1" DATE;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "generic_date2" DATE;

-- Add generic fields to Payment
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "generic_text1" VARCHAR;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "generic_text2" VARCHAR;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "generic_number1" DOUBLE PRECISION;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "generic_number2" DOUBLE PRECISION;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "generic_date1" DATE;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "generic_date2" DATE;

-- Backfill default generic_field_config for all existing accounts
UPDATE "Account"
SET generic_field_config = '{
  "customer": {
    "text1": {"enabled": false, "label": "Custom Text 1", "read_only": false},
    "text2": {"enabled": false, "label": "Custom Text 2", "read_only": false},
    "number1": {"enabled": false, "label": "Custom Number 1", "read_only": false},
    "number2": {"enabled": false, "label": "Custom Number 2", "read_only": false},
    "date1": {"enabled": false, "label": "Custom Date 1", "read_only": false},
    "date2": {"enabled": false, "label": "Custom Date 2", "read_only": false}
  },
  "contact": {
    "text1": {"enabled": false, "label": "Custom Text 1", "read_only": false},
    "text2": {"enabled": false, "label": "Custom Text 2", "read_only": false},
    "number1": {"enabled": false, "label": "Custom Number 1", "read_only": false},
    "number2": {"enabled": false, "label": "Custom Number 2", "read_only": false},
    "date1": {"enabled": false, "label": "Custom Date 1", "read_only": false},
    "date2": {"enabled": false, "label": "Custom Date 2", "read_only": false}
  },
  "invoice": {
    "text1": {"enabled": false, "label": "Custom Text 1", "read_only": false},
    "text2": {"enabled": false, "label": "Custom Text 2", "read_only": false},
    "number1": {"enabled": false, "label": "Custom Number 1", "read_only": false},
    "number2": {"enabled": false, "label": "Custom Number 2", "read_only": false},
    "date1": {"enabled": false, "label": "Custom Date 1", "read_only": false},
    "date2": {"enabled": false, "label": "Custom Date 2", "read_only": false}
  },
  "payment": {
    "text1": {"enabled": false, "label": "Custom Text 1", "read_only": false},
    "text2": {"enabled": false, "label": "Custom Text 2", "read_only": false},
    "number1": {"enabled": false, "label": "Custom Number 1", "read_only": false},
    "number2": {"enabled": false, "label": "Custom Number 2", "read_only": false},
    "date1": {"enabled": false, "label": "Custom Date 1", "read_only": false},
    "date2": {"enabled": false, "label": "Custom Date 2", "read_only": false}
  }
}'::jsonb
WHERE generic_field_config IS NULL;

COMMIT;
