-- Demo account (is_demo) replaces has_file_import for import catalog gating.
ALTER TABLE "Account"
DROP COLUMN IF EXISTS "has_file_import";
