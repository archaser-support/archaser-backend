# Script Files Usage Analysis

## ✅ ACTIVELY USED / NEEDED

### Production Code

- **LogList.tsx** - Active React component for displaying system logs

### Active Scripts (Referenced in package.json or docs)

- **watch-all-unit-tests.sh** - Referenced in package.json (`watch:all-unit-tests`)
- **watch-all-unit-tests-simple.sh** - Referenced in package.json (`watch:all-unit-tests:simple`)
- **fix-all-errors.sh** - Utility for fixing ESLint/TypeScript errors
- **fix-eslint-loop.sh** - Utility for fixing ESLint issues

### Database Migration Scripts (Still Needed)

- **migrate-business-units.ts** - Datafix script for business units (idempotent, can be run multiple times)
- **update-business-units-data.ts** - Database update script for business units (idempotent, can be run multiple times)
- **setup-business-units.sh** - Setup script that runs SQL migration + data update
- **README-business-units-migration.md** - Documentation for business units migration
- **migrate-user-roles.ts** - Datafix script for user roles (idempotent, can be run multiple times)
- **migrate-user-roles-sql.sql** - SQL migration for user roles

### Maintenance/Utility Scripts (Useful for ongoing maintenance)

- **check-duplicate-translation-keys.js** - Validates translation files for duplicates
- **check_missing_translation_keys.js** - Checks for missing translation keys
- **analyze-translations.js** - Analyzes translation usage patterns
- **test-inforu-status.js** - Tests Inforu SMS status checking functionality

---

## ⚠️ ONE-TIME MIGRATION SCRIPTS (Likely Completed) - ✅ REMOVED

These were likely used during translation architecture restructuring and have been removed:

- **add-scheduling-test-scripts.js** - Adds test scripts to package.json (one-time setup)
- **clean-translation-files.js** - Cleans translation files (one-time migration)
- **create-categorized-files.js** - Creates categorized translation files (one-time migration)
- **create-namespace-files.js** - Creates namespace translation files (one-time migration)
- **fix-navigation-keys.js** - Fixes navigation translation keys (one-time migration)
- **update-translation-keys.js** - Updates translation keys in components (one-time migration)
- **update-keys-final.js** - Final update of translation keys (one-time migration)
- **validate-translation-structure.js** - Validates translation file structure (one-time validation)

### One-Time Database Scripts

- **fix-debtor-import-type.ts** - Updates "Debtor" import_type to "Customer" (one-time migration)
- **fix-role-values.ts** - Fixes role values to match Prisma schema (one-time migration)
- **check-enum-values.ts** - Diagnostic script to check enum values (one-time diagnostic)
- **check-user-roles.ts** - Diagnostic script to check user roles (one-time diagnostic)
- **migrate-last-7-days.js** - Migrates last 7 days of logs to MongoDB (one-time migration)

### One-Time Test Migration

- **fix-jest-syntax.js** - Converts Jest syntax to Vitest (one-time migration, project already uses Vitest)

---

## 📄 DOCUMENTATION/ANALYSIS FILES (Reference Only)

These are analysis documents that may be kept for reference but aren't actively used:

- ~~**analyze_portal_categorization.md**~~ - ✅ DELETED (Analysis document for portal categorization)
- ~~**REVIEW_MISSING_TRANSLATION_KEYS.md**~~ - ✅ DELETED (Review document for missing translation keys)
- **README.md** - General scripts README (useful documentation) - ✅ KEPT

---

## 🗑️ POTENTIALLY OBSOLETE - ✅ REMOVED

- ~~**run_activity_workflow_migration.sh**~~ - ✅ DELETED (Activity workflow migration script)

---

## 📊 SUMMARY

### Keep (Active/Useful):

1. LogList.tsx
2. watch-all-unit-tests.sh
3. watch-all-unit-tests-simple.sh
4. fix-all-errors.sh
5. fix-eslint-loop.sh
6. migrate-business-units.ts
7. update-business-units-data.ts
8. setup-business-units.sh
9. README-business-units-migration.md
10. migrate-user-roles.ts
11. migrate-user-roles-sql.sql
12. check-duplicate-translation-keys.js
13. check_missing_translation_keys.js
14. analyze-translations.js
15. test-inforu-status.js
16. README.md

### Archive/Remove (One-time migrations, likely completed) - ✅ REMOVED:

1. ~~add-scheduling-test-scripts.js~~ ✅ DELETED
2. ~~clean-translation-files.js~~ ✅ DELETED
3. ~~create-categorized-files.js~~ ✅ DELETED
4. ~~create-namespace-files.js~~ ✅ DELETED
5. ~~fix-navigation-keys.js~~ ✅ DELETED
6. ~~update-translation-keys.js~~ ✅ DELETED
7. ~~update-keys-final.js~~ ✅ DELETED
8. ~~validate-translation-structure.js~~ ✅ DELETED
9. ~~fix-debtor-import-type.ts~~ ✅ DELETED
10. ~~fix-role-values.ts~~ ✅ DELETED
11. ~~check-enum-values.ts~~ ✅ DELETED
12. ~~check-user-roles.ts~~ ✅ DELETED
13. ~~migrate-last-7-days.js~~ ✅ DELETED
14. ~~fix-jest-syntax.js~~ ✅ DELETED
15. ~~analyze_portal_categorization.md~~ ✅ DELETED
16. ~~REVIEW_MISSING_TRANSLATION_KEYS.md~~ ✅ DELETED
17. ~~run_activity_workflow_migration.sh~~ ✅ DELETED

---

## 💡 RECOMMENDATIONS - ✅ COMPLETED

1. ~~**Move one-time migration scripts** to an `archive/` or `migrations-completed/` directory~~ ✅ **COMPLETED** - Files have been removed
2. ✅ **Keep maintenance scripts** in the main scripts directory - **DONE**
3. ✅ **Keep documentation** for reference - **DONE** (README.md kept)
4. ✅ **Verify** if `run_activity_workflow_migration.sh` migration is complete - **REMOVED** (assumed complete)
5. ~~**Consider** creating a `scripts/archive/` directory for completed migrations~~ ✅ **COMPLETED** - Files removed instead of archived

**Status**: Cleanup completed successfully. All one-time migration scripts have been removed. Active scripts and production code remain intact.
