-- Rename Invoice.priority_erp_debit to custom_code1 and update stored connector mappings.
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260825_rename_priority_erp_debit_to_custom_code1.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Invoice'
      AND column_name = 'priority_erp_debit'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Invoice'
      AND column_name = 'custom_code1'
  ) THEN
    ALTER TABLE "Invoice" RENAME COLUMN "priority_erp_debit" TO "custom_code1";
  END IF;
END $$;

UPDATE "ConnectorFieldMapping"
SET mapping = (
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN elem->>'archaserField' = 'priority_erp_debit'
        THEN jsonb_set(elem, '{archaserField}', '"custom_code1"')
        ELSE elem
      END
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(mapping) AS elem
)
WHERE mapping @> '[{"archaserField": "priority_erp_debit"}]';

COMMIT;
