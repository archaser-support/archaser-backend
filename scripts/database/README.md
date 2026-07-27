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

See the comprehensive guide: [Database Migration Guide](../../docs/development-guides/database-migration-guide.md)

**Quick Steps:**

1. Create SQL file in `prisma/migrations/`
2. Create runner script in `scripts/database/`
3. Make script executable: `chmod +x scripts/database/run-your-migration.sh`
4. Test the migration
5. Run: `npx prisma generate`

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
