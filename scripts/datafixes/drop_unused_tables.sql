-- ============================================================
-- DATAFIX: Drop unused tables — Session, state_with_timezones
--
-- Date:      2026-03-08
-- Verified:  Neither table is referenced in Prisma schema,
--            application code, or any foreign keys.
-- ============================================================


-- ============================================================
-- STEP 1: SAFETY CHECK — confirm no foreign keys reference these tables
-- ============================================================
SELECT
    tc.table_name       AS referencing_table,
    kcu.column_name     AS referencing_column,
    ccu.table_name      AS referenced_table,
    ccu.column_name     AS referenced_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage  AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema   = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema   = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name IN ('Session', 'state_with_timezones');

-- Expected result: 0 rows. If any rows appear, DO NOT proceed.


-- ============================================================
-- STEP 2: SAFETY CHECK — check row counts before dropping
-- ============================================================
SELECT 'Session'              AS table_name, COUNT(*) AS row_count FROM "Session"
UNION ALL
SELECT 'state_with_timezones' AS table_name, COUNT(*) AS row_count FROM "state_with_timezones";


-- ============================================================
-- STEP 3: DROP THE TABLES
-- (Only run after confirming Steps 1 and 2 above)
-- ============================================================
DROP TABLE IF EXISTS "Session";
DROP TABLE IF EXISTS "state_with_timezones";


-- ============================================================
-- STEP 4: VERIFY — these should return errors (tables gone)
-- ============================================================
SELECT to_regclass('public."Session"')              AS session_exists;
SELECT to_regclass('public."state_with_timezones"') AS state_tz_exists;
-- Both should return NULL if dropped successfully
