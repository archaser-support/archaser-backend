-- Manual SQL Migration: Replace InvoiceStatus table with invoice_status enum

-- 1. Create the enum type
DO $$ BEGIN
    CREATE TYPE "invoice_status" AS ENUM (
        'Open', 'Paid', 'Overdue', 'Partially_Paid', 'Void', 
        'Under_Dispute', 'Due', 'Draft', 'Sent', 'Viewed', 'Cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Add temporary column to Invoice table
ALTER TABLE "Invoice" ADD COLUMN "status_new" "invoice_status";

-- 3. Migrate existing data
-- Mapping based on InvoiceService constants and common status IDs
UPDATE "Invoice" SET "status_new" = CASE
    WHEN "status_id" = 1 THEN 'Open'::"invoice_status"
    WHEN "status_id" = 2 THEN 'Paid'::"invoice_status"
    WHEN "status_id" = 3 THEN 'Overdue'::"invoice_status"
    WHEN "status_id" = 4 THEN 'Partially_Paid'::"invoice_status"
    WHEN "status_id" = 5 THEN 'Void'::"invoice_status"
    WHEN "status_id" = 7 THEN 'Paid'::"invoice_status"
    WHEN "status_id" = 13 THEN 'Due'::"invoice_status"
    ELSE 'Open'::"invoice_status"
END;

-- 4. Clean up constraints and old column
-- Ensure all records have a status
UPDATE "Invoice" SET "status_new" = 'Open' WHERE "status_new" IS NULL;

ALTER TABLE "Invoice" ALTER COLUMN "status_new" SET NOT NULL;

-- Remove old relation and column
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_status_id_fkey";
ALTER TABLE "Invoice" DROP COLUMN "status_id";

-- Rename new column
ALTER TABLE "Invoice" RENAME COLUMN "status_new" TO "status";

-- 5. Drop the legacy table
DROP TABLE IF EXISTS "InvoiceStatus";

-- 6. Re-create indexes
CREATE INDEX "idx_invoice_customer_status" ON "Invoice"("customer_id", "status");
CREATE INDEX "idx_invoice_due_date_status" ON "Invoice"("due_date", "status");

--------------------------------------------------------------------------------
-- 7. Fix saved report configurations (Report.report_config JSON)
--    - Replace legacy Invoice.status_id field with Invoice.status
--    - Convert numeric status codes to enum values:
--        * 13 -> 'Due'
--        * 3  -> 'Overdue'
--------------------------------------------------------------------------------

-- 7.1 Replace any remaining "status_id" field references on Invoice with "status"
UPDATE "Report"
SET report_config =
    REPLACE(
        report_config::text,
        '"field":"status_id"',
        '"field":"status"'
    )::jsonb
WHERE report_config::text LIKE '%"Invoice"%'
  AND report_config::text LIKE '%"status_id"%';

-- 7.2 Replace sorting on Invoice.status_id with Invoice.status
UPDATE "Report"
SET report_config =
    REPLACE(
        report_config::text,
        '"field":"Invoice.status_id"',
        '"field":"Invoice.status"'
    )::jsonb
WHERE report_config::text LIKE '%"field":"Invoice.status_id"%';

-- 7.3 Map numeric status code 13 -> 'Due' for Invoice.status filters
-- Handles common pretty-printed JSON used by the report builder.
UPDATE "Report"
SET report_config =
    regexp_replace(
        report_config::text,
        '"field"\s*:\s*"status"\s*,\s*"table"\s*:\s*"Invoice"\s*,\s*"value"\s*:\s*13',
        '"field":"status","table":"Invoice","value":"Due"',
        'g'
    )::jsonb
WHERE report_config::text LIKE '%"Invoice"%'
  AND report_config::text LIKE '%"field"%status"%'
  AND report_config::text ~ '"value"\s*:\s*13';

-- 7.4 Map numeric status code 3 -> 'Overdue' for Invoice.status filters
UPDATE "Report"
SET report_config =
    regexp_replace(
        report_config::text,
        '"field"\s*:\s*"status"\s*,\s*"table"\s*:\s*"Invoice"\s*,\s*"value"\s*:\s*3',
        '"field":"status","table":"Invoice","value":"Overdue"',
        'g'
    )::jsonb
WHERE report_config::text LIKE '%"Invoice"%'
  AND report_config::text LIKE '%"field"%status"%'
  AND report_config::text ~ '"value"\s*:\s*3';

-- 7.5 Map numeric IN filters [3, 13] -> ["Overdue","Due"] for Invoice.status
UPDATE "Report"
SET report_config =
    regexp_replace(
        report_config::text,
        '"field"\s*:\s*"status"\s*,\s*"table"\s*:\s*"Invoice"\s*,\s*"value"\s*:\s*\[\s*3\s*,\s*13\s*\]',
        '"field":"status","table":"Invoice","value":["Overdue","Due"]',
        'g'
    )::jsonb
WHERE report_config::text LIKE '%"Invoice"%'
  AND report_config::text LIKE '%"field"%status"%'
  AND report_config::text ~ '"value"\s*:\s*\[\s*3\s*,\s*13\s*\]';

-- Also handle reversed order [13, 3] if any exist
UPDATE "Report"
SET report_config =
    regexp_replace(
        report_config::text,
        '"field"\s*:\s*"status"\s*,\s*"table"\s*:\s*"Invoice"\s*,\s*"value"\s*:\s*\[\s*13\s*,\s*3\s*\]',
        '"field":"status","table":"Invoice","value":["Due","Overdue"]',
        'g'
    )::jsonb
WHERE report_config::text LIKE '%"Invoice"%'
  AND report_config::text LIKE '%"field"%status"%'
  AND report_config::text ~ '"value"\s*:\s*\[\s*13\s*,\s*3\s*\]';

-- 7.6 Sanity check queries (optional, run manually if you want to verify)
-- SELECT id, name FROM "Report"
-- WHERE report_config::text LIKE '%"Invoice"%'
--   AND report_config::text LIKE '%"status_id"%';
--
-- SELECT id, name FROM "Report"
-- WHERE report_config::text LIKE '%"Invoice"%'
--   AND report_config::text LIKE '%"field":"status"%'
--   AND report_config::text ~ '"value"\s*:\s*(3|13)';

--------------------------------------------------------------------------------
-- 8. Sync per-account report configs from the admin/system account
--    Many accounts have cloned versions of the same reports:
--      - "All Unpaid Invoices"
--      - "Due Invoices"
--      - "Overdue Invoices"
--    To keep them consistent after this migration, copy the admin/system
--    report_config to all other accounts for the same report name.
--
--    NOTE:
--      - 10013 is the SYSTEM_ADMIN_ACCOUNT_ID in the application.
--        If your admin account differs in production, adjust account_id below.
--------------------------------------------------------------------------------

-- 8.1 All Unpaid Invoices
WITH master_all_unpaid AS (
    SELECT report_config
    FROM "Report"
    WHERE account_id = 10013
      AND name = 'All Unpaid Invoices'
    LIMIT 1
)
UPDATE "Report" r
SET report_config = m.report_config
FROM master_all_unpaid m
WHERE r.name = 'All Unpaid Invoices'
  AND r.account_id <> 10013;

-- 8.2 Due Invoices
WITH master_due AS (
    SELECT report_config
    FROM "Report"
    WHERE account_id = 10013
      AND name = 'Due Invoices'
    LIMIT 1
)
UPDATE "Report" r
SET report_config = m.report_config
FROM master_due m
WHERE r.name = 'Due Invoices'
  AND r.account_id <> 10013;

-- 8.3 Overdue Invoices
WITH master_overdue AS (
    SELECT report_config
    FROM "Report"
    WHERE account_id = 10013
      AND name = 'Overdue Invoices'
    LIMIT 1
)
UPDATE "Report" r
SET report_config = m.report_config
FROM master_overdue m
WHERE r.name = 'Overdue Invoices'
  AND r.account_id <> 10013;
