-- ============================================================
-- DATAFIX: Replace "Debtor Name" label and {{account_name}}
--          with "Customer Name" / {{customer_name}}
--          in all InternalEmailTemplate records (content + subject)
--
-- Date:    2026-03-08
-- Ticket:  Internal email template variable rename
-- Safe to re-run: YES (LIKE guards prevent double-replacement)
-- ============================================================


-- ============================================================
-- STEP 1: PREVIEW — see which templates will be affected
-- ============================================================
SELECT
    id,
    account_id,
    type,
    name,
    CASE WHEN content LIKE '%Debtor Name%'      THEN '✓' ELSE '' END AS label_fix,
    CASE WHEN content LIKE '%{{account_name}}%' THEN '✓' ELSE '' END AS content_var_fix,
    CASE WHEN subject LIKE '%{{account_name}}%' THEN '✓' ELSE '' END AS subject_var_fix
FROM "InternalEmailTemplate"
WHERE
    content LIKE '%Debtor Name%'
    OR content LIKE '%{{account_name}}%'
    OR subject LIKE '%{{account_name}}%'
ORDER BY account_id, type;


-- ============================================================
-- STEP 2: FIX content — replace label text + variable
-- ============================================================
UPDATE "InternalEmailTemplate"
SET
    content     = REPLACE(
                      REPLACE(content, 'Debtor Name', 'Customer Name'),
                      '{{account_name}}', '{{customer_name}}'
                  ),
    modified_at = NOW()
WHERE
    content LIKE '%Debtor Name%'
    OR content LIKE '%{{account_name}}%';


-- ============================================================
-- STEP 3: FIX subject — replace variable (if present)
-- ============================================================
UPDATE "InternalEmailTemplate"
SET
    subject     = REPLACE(subject, '{{account_name}}', '{{customer_name}}'),
    modified_at = NOW()
WHERE
    subject LIKE '%{{account_name}}%';


-- ============================================================
-- STEP 4: VERIFY — should return 0 rows after the fix
-- ============================================================
SELECT id, account_id, type, name
FROM "InternalEmailTemplate"
WHERE
    content LIKE '%Debtor Name%'
    OR content LIKE '%{{account_name}}%'
    OR subject LIKE '%{{account_name}}%';
