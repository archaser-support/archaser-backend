-- ============================================================
-- DATAFIX: Rename table user_import_mappings → UserImportMappings
--
-- Date:    2026-03-08
-- Note:    After running this SQL, also run `npx prisma generate`
--          to regenerate the Prisma client with the new model name.
-- ============================================================


-- ============================================================
-- STEP 1: RENAME THE TABLE
-- ============================================================
ALTER TABLE "user_import_mappings" RENAME TO "UserImportMappings";


-- ============================================================
-- STEP 2: RENAME INDEXES to match new naming convention
-- ============================================================
ALTER INDEX IF EXISTS "idx_user_import_mapping_created_by"  RENAME TO "idx_UserImportMappings_created_by";
ALTER INDEX IF EXISTS "idx_user_import_mapping_modified_by" RENAME TO "idx_UserImportMappings_modified_by";
ALTER INDEX IF EXISTS "idx_user_import_mappings_user_type"  RENAME TO "idx_UserImportMappings_user_type";
ALTER INDEX IF EXISTS "unique_user_import_type_name"        RENAME TO "unique_UserImportMappings_user_import_type_name";


-- ============================================================
-- STEP 3: VERIFY
-- ============================================================
SELECT to_regclass('public."UserImportMappings"') AS new_table_exists;
-- Should return: UserImportMappings

SELECT to_regclass('public."user_import_mappings"') AS old_table_exists;
-- Should return: NULL
