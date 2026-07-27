-- Collapse reporting_reference + reporting_comment into a single `reporting_comment` column.
-- Run: psql "$DATABASE_URL" -f prisma/migrations/20260423_merge_invoice_reporting_ref_into_comment.sql
BEGIN;

-- Merge into reporting_comment, then drop reporting_reference
UPDATE "Invoice" AS i
SET "reporting_comment" = TRIM(
  CASE
    WHEN (i."reporting_reference" IS NULL OR BTRIM(i."reporting_reference"::text) = '')
     AND (i."reporting_comment" IS NULL OR BTRIM(i."reporting_comment"::text) = '')
    THEN NULL
    WHEN (i."reporting_reference" IS NULL OR BTRIM(i."reporting_reference"::text) = '')
    THEN BTRIM(i."reporting_comment"::text)
    WHEN (i."reporting_comment" IS NULL OR BTRIM(i."reporting_comment"::text) = '')
    THEN BTRIM(i."reporting_reference"::text)
    ELSE BTRIM(i."reporting_reference"::text) || E' — ' || BTRIM(i."reporting_comment"::text)
  END
)
WHERE (i."reporting_reference" IS NOT NULL AND BTRIM(i."reporting_reference"::text) <> '')
   OR (i."reporting_comment" IS NOT NULL AND BTRIM(i."reporting_comment"::text) <> '');

ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "reporting_reference";

COMMIT;
