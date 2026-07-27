-- Update InternalEmailTemplate content: replace "Debtor Name" / {{account_name}} with "Customer Name" / {{customer_name}}
-- Replaces: <li><strong>Debtor Name:</strong> {{account_name}}</li>
-- With:     <li><strong>Customer Name:</strong> {{customer_name}}</li>

UPDATE "InternalEmailTemplate"
SET "content" = REPLACE(
  "content",
  '<li><strong>Debtor Name:</strong> {{account_name}}</li>',
  '<li><strong>Customer Name:</strong> {{customer_name}}</li>'
)
WHERE "content" LIKE '%<li><strong>Debtor Name:</strong> {{account_name}}</li>%';

-- Optional: verify affected rows (run as SELECT before running UPDATE if desired)
-- SELECT id, name, type, "account_id"
-- FROM "InternalEmailTemplate"
-- WHERE "content" LIKE '%<li><strong>Debtor Name:</strong> {{account_name}}</li>%';
