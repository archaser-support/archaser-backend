# Database Scripts

This directory contains database-related scripts including migrations, setup, and data management utilities.

## Migration Scripts

### Running Migrations

```bash
# Run a specific migration (if runner script exists)
./scripts/database/run-cron-monitoring-migration.sh

# Setup MongoDB collection (for CronJobExecution)
npx tsx scripts/database/setup-cron-job-execution-mongodb.ts
# Or with options:
npx tsx scripts/database/setup-cron-job-execution-mongodb.ts --skip-migration --skip-validation

# For production MongoDB (use environment variable or command line):
export MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/dbname"
npx tsx scripts/database/setup-cron-job-execution-mongodb.ts --skip-migration

# Or specify URI directly:
npx tsx scripts/database/setup-cron-job-execution-mongodb.ts --uri="mongodb+srv://user:pass@cluster.mongodb.net/dbname" --skip-migration

# Or use the TypeScript migration runner
npx ts-node scripts/database/run-migration.ts prisma/migrations/your_migration.sql

# Or use psql directly
psql "$DATABASE_URL" -f prisma/migrations/your_migration.sql
```

### Creating New Migrations

Staging and production deploys apply new files in `prisma/migrations/` before the new containers start. Files already in that folder when the runner was turned on are recorded and are not run again. Scripts outside `prisma/migrations/` are not part of the deploy.

**New file rules:**

1. Name the file `YYYYMMDD_description.sql`. When two files share a day and order matters, use `_01_` and `_02_` in the name so alphabetical order matches the sequence.
2. Do not put `BEGIN` or `COMMIT` in the file. The deploy opens one transaction for the file.
3. Do not use `CREATE INDEX CONCURRENTLY` or `VACUUM`. Use a normal `CREATE INDEX`.
4. Ship a drop or a rename only in a later release, after the running app no longer uses the old column.
5. Do not edit a file that has already deployed. Add a new dated file instead.
6. Run `npx prisma generate` after the Prisma schema changes.

Do not paste new migration files into DBeaver for staging or production. The deploy runs them.

## Available Scripts

- `run-cron-monitoring-migration.sh` - Adds cron job monitoring fields to CronJob table (NOTE: CronJobExecution parts are obsolete, migrated to MongoDB)
- `setup-cron-job-execution-mongodb.ts` - Sets up CronJobExecution collection in MongoDB (creates indexes, optionally migrates data)
- `remove-cron-job-execution-from-postgres.sh` - Removes CronJobExecution table and enum (after MongoDB migration)
- `run-migration.ts` - Generic TypeScript migration runner
- `setup-internal-email-templates.sh` - Setup internal email templates

## SQL Template Files

- `English-Activity-Templates.sql`
- `French-Activity-Templates.sql`
- `German-Activity-Templates.sql`
- `Hebrew-Activity-Templates.sql`
- `Italian-Activity-Templates.sql`
- `Portuguese-Activity-Templates.sql`
- `Spanish-Activity-Templates.sql`

## Documentation

- **[Database Migration Guide](../../docs/development-guides/database-migration-guide.md)** - Complete guide on creating and running migrations
- **[Business Units Migration Guide](../README-business-units-migration.md)** - Example of a specific migration

## Requirements

- PostgreSQL client tools (`psql`) installed
- `DATABASE_URL` environment variable set (or in `.env` file)
- Node.js and npm for TypeScript migration runner

## Troubleshooting

If you encounter issues:

1. **"psql: command not found"** - Install PostgreSQL client tools
2. **"DATABASE_URL not set"** - Check your `.env` file or export it manually
3. **"invalid URI query parameter"** - The runner script handles this automatically
4. **"permission denied"** - Ensure your database user has necessary permissions

See the [Database Migration Guide](../../docs/development-guides/database-migration-guide.md) for detailed troubleshooting steps.
