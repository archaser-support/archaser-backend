-- Copy report id 1458 to all other accounts
-- Inserts a new copy for each account that doesn't have one; updates existing copies with the same unique_name.

INSERT INTO "Report" (
  account_id,
  name,
  unique_name,
  description,
  report_config,
  is_public,
  is_system,
  is_default,
  context,
  created_at,
  modified_at,
  created_by,
  modified_by
)
SELECT
  a.id,
  r.name,
  r.unique_name,
  r.description,
  r.report_config,
  r.is_public,
  r.is_system,
  r.is_default,
  r.context,
  now(),
  now(),
  r.created_by,
  r.modified_by
FROM "Account" a
CROSS JOIN (SELECT * FROM "Report" WHERE id = 1458) r
WHERE a.id != r.account_id
ON CONFLICT ("account_id", "unique_name")
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  report_config = EXCLUDED.report_config,
  is_public = EXCLUDED.is_public,
  is_system = EXCLUDED.is_system,
  is_default = EXCLUDED.is_default,
  context = EXCLUDED.context,
  modified_at = now();
