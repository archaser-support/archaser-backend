# Business Units Database Migration Guide

This guide explains how to set up the BusinessUnit table and populate it with initial data.

## Overview

The Business Units feature requires:

1. **SQL Migration**: Creates the `BusinessUnit` table and related columns
2. **Data Update Script**: Populates the table with primary business units and fixes data integrity issues

## Quick Start

### Option 1: Automated Setup (Recommended)

Run the setup script that handles both steps:

```bash
# Dry run (preview changes)
./scripts/setup-business-units.sh --dry-run

# Apply changes to all accounts
./scripts/setup-business-units.sh

# Apply changes to a specific account only
./scripts/setup-business-units.sh --account-id=10013
```

### Option 2: Manual Setup

#### Step 1: Run SQL Migration

Create the database table and columns:

```bash
# Using psql directly
psql -d your_database_name -f prisma/migrations/create_business_unit_table.sql

# Or using DATABASE_URL environment variable
psql "$DATABASE_URL" -f prisma/migrations/create_business_unit_table.sql
```

**What this does:**

- Creates `BusinessUnit` table with all fields, indexes, and constraints
- Adds `business_unit_id` column to `Customer` table (if missing)
- Adds `business_unit_id` column to `User` table (if missing)
- Creates all necessary foreign key constraints and indexes

#### Step 2: Run Data Update Script

Populate the table and fix data integrity:

```bash
# Dry run (preview changes)
npx ts-node scripts/update-business-units-data.ts --dry-run

# Apply changes to all accounts
npx ts-node scripts/update-business-units-data.ts

# Apply changes to a specific account only
npx ts-node scripts/update-business-units-data.ts --account-id=10013

# Skip fixing orphaned references
npx ts-node scripts/update-business-units-data.ts --no-fix-orphans
```

**What this does:**

- Verifies `BusinessUnit` table exists
- Creates primary business units for all accounts that don't have one
- Assigns users without BU assignments to their account's primary BU
- Fixes orphaned BU references (customers/users with invalid BU IDs)
- Updates null `created_by`/`modified_by` fields
- Fixes circular parent references
- Resolves duplicate `external_id` values within accounts

## Migration Files

### SQL Migration

- **File**: `prisma/migrations/create_business_unit_table.sql`
- **Purpose**: Creates database schema (table, columns, indexes, constraints)
- **Idempotent**: Safe to run multiple times (checks if table exists)

### Data Update Script

- **File**: `scripts/update-business-units-data.ts`
- **Purpose**: Populates data and fixes integrity issues
- **Idempotent**: Safe to run multiple times

### Setup Script

- **File**: `scripts/setup-business-units.sh`
- **Purpose**: Runs both SQL migration and data update script
- **Requirements**: `psql` command available, `DATABASE_URL` environment variable set

## Database Schema

### BusinessUnit Table

```sql
CREATE TABLE "BusinessUnit" (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    name VARCHAR NOT NULL,
    parent_id INTEGER,
    external_id VARCHAR,
    status record_status NOT NULL DEFAULT 'Active',
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    created_by VARCHAR,
    modified_by VARCHAR
);
```

### Related Columns

- `Customer.business_unit_id` - Links customers to business units
- `User.business_unit_id` - Links users to business units

## Verification

After running the migration, verify the setup:

```sql
-- Check if table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'BusinessUnit'
);

-- Count primary business units per account
SELECT account_id, COUNT(*) as primary_bu_count
FROM "BusinessUnit"
WHERE is_primary = true
GROUP BY account_id;

-- Check users without BU assignments
SELECT COUNT(*)
FROM "User"
WHERE business_unit_id IS NULL;

-- Check customers without BU assignments
SELECT COUNT(*)
FROM "Customer"
WHERE business_unit_id IS NULL;
```

## Troubleshooting

### Error: "BusinessUnit table does not exist"

**Solution**: Run the SQL migration first:

```bash
psql "$DATABASE_URL" -f prisma/migrations/create_business_unit_table.sql
```

### Error: "Permission denied" or "Access denied"

**Solution**: Ensure your database user has CREATE TABLE and ALTER TABLE permissions.

### Error: "Foreign key constraint violation"

**Solution**: The script handles orphaned references automatically. If errors persist, run with `--fix-orphans` flag (enabled by default).

### Error: "record_status enum does not exist"

**Solution**: The `record_status` enum should already exist in your database. If not, check your Prisma schema and ensure all enums are created.

## Safety Features

- ✅ **Idempotent**: All scripts can be run multiple times safely
- ✅ **Dry-run mode**: Preview changes before applying
- ✅ **Transaction-based**: SQL migration uses transactions (rollback on error)
- ✅ **Account filtering**: Test on a single account first
- ✅ **Error handling**: Continues processing even if individual records fail
- ✅ **Detailed logging**: Shows exactly what's being changed

## Rollback

If you need to rollback the migration:

```sql
BEGIN;

-- Remove foreign key constraints first
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_business_unit_id_fkey";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_business_unit_id_fkey";

-- Drop columns
ALTER TABLE "Customer" DROP COLUMN IF EXISTS business_unit_id;
ALTER TABLE "User" DROP COLUMN IF EXISTS business_unit_id;

-- Drop table (this will fail if there are still references)
DROP TABLE IF EXISTS "BusinessUnit" CASCADE;

COMMIT;
```

**Warning**: This will delete all business unit data. Only use if you're sure you want to remove the feature completely.

## Next Steps

After running the migration:

1. Verify all accounts have primary business units
2. Assign users to appropriate business units (if not done automatically)
3. Assign customers to business units (if needed)
4. Test access control features
5. Review business unit hierarchy

## Support

For issues or questions:

- Check the migration logs for detailed error messages
- Review the Prisma schema: `prisma/schema.prisma`
- Check existing migration scripts: `prisma/migrations/`
