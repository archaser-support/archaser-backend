# Scripts Directory

This directory contains all utility scripts organized by category for better maintainability and discoverability.

## Directory Structure

### 📁 testing/

Scripts related to testing, test execution, and test monitoring.

**Files:**

- `run-local-tests.sh` - Run local test suite
- `test-account-creation.sh` - Account creation test script
- `test-assign-user.js` - User assignment testing
- `test-log-activity.sh` - Activity logging tests
- `test-notification-connection.js` - Notification connection testing
- `test-notification-realtime.js` - Real-time notification testing
- `test-unit.sh` - Unit test execution
- `test-welcome-email.js` - Welcome email testing (JavaScript)
- `test-welcome-email.ts` - Welcome email testing (TypeScript)
- `watch-account-creation-tests.sh` - Watch mode for account creation tests
- `watch-portal-tests.sh` - Watch mode for portal tests

### 📁 database/

Database-related scripts including migrations, setup, and data management.

**Files:**

- `English-Activity-Templates.sql` - English activity templates
- `French-Activity-Templates.sql` - French activity templates
- `German-Activity-Templates.sql` - German activity templates
- `Hebrew-Activity-Templates.sql` - Hebrew activity templates
- `Italian-Activity-Templates.sql` - Italian activity templates
- `Portuguese-Activity-Templates.sql` - Portuguese activity templates
- `Spanish-Activity-Templates.sql` - Spanish activity templates
- `setup-internal-email-templates.sh` - Internal email templates setup
- `run-cron-monitoring-migration.sh` - Run cron job monitoring migration
- `run-migration.ts` - TypeScript migration runner utility

**Documentation:**

- [Database Migration Guide](../../docs/development-guides/database-migration-guide.md) - How to create and run database migrations
- [Business Units Migration Guide](README-business-units-migration.md) - Specific migration example

### 📁 development/

Development environment setup and debugging scripts.

**Files:**

- `create-test-user.js` - Create test user for development
- `debug-account-creation.js` - Debug account creation process
- `dev-with-account-tests.sh` - Development with account tests
- `dev-with-logout-tests.sh` - Development with logout tests

### 📁 utilities/

General utility scripts for maintenance and fixes.

**Files:**

- `testEmail.ts` - Email testing utility

### 📁 deployment/

Deployment-related scripts.

**Files:**

- `deploy-backend-docker.sh` - Centralized EC2 deploy for backend Docker stacks (Nest API, Redis, worker, SMS, connectors, reports, and optional Grafana/Loki/Prometheus)

## Usage

### Running Tests

```bash
# Run all tests
./testing/run-local-tests.sh

# Run specific test suites
./testing/test-account-creation.sh
./testing/test-unit.sh

# Watch mode for development
./testing/watch-account-creation-tests.sh
```

### Development Setup

```bash
# Start development with tests
./development/dev-with-account-tests.sh

# Debug account creation
node development/debug-account-creation.js

# Create test user
node development/create-test-user.js
```

### Database Operations

```bash
# Setup internal email templates
./database/setup-internal-email-templates.sh

# Run database migrations
./database/run-cron-monitoring-migration.sh

# Or use the TypeScript migration runner
npx ts-node database/run-migration.ts prisma/migrations/your_migration.sql
```

**See**: [Database Migration Guide](../../docs/development-guides/database-migration-guide.md) for detailed instructions on creating and running migrations.

### Utilities

```bash
# Test email functionality
node utilities/testEmail.ts
```

### Deployment (EC2 Docker)

```bash
# From backend checkout on EC2 (staging default: /home/ubuntu/api)
bash scripts/deployment/deploy-backend-docker.sh --env staging
bash scripts/deployment/deploy-backend-docker.sh --env production

# Optional flags
bash scripts/deployment/deploy-backend-docker.sh --env staging --no-grafana
bash scripts/deployment/deploy-backend-docker.sh --env staging --skip-install --skip-build
```

Or via npm scripts:

```bash
npm run deploy:docker:staging
npm run deploy:docker:production
```

## Script Categories

- **Testing**: All test-related scripts for unit, integration, and end-to-end testing
- **Database**: SQL files and database setup/migration scripts
- **Development**: Development environment setup and debugging tools
- **Utilities**: Maintenance and fix scripts for common issues
- **Deployment**: EC2 deployment automation scripts

## Best Practices

1. **Naming Convention**: Use descriptive names with hyphens for separation
2. **File Extensions**:
    - `.sh` for shell scripts
    - `.js` for Node.js scripts
    - `.ts` for TypeScript scripts
    - `.sql` for database scripts
3. **Permissions**: Ensure shell scripts have execute permissions (`chmod +x`)
4. **Documentation**: Each script should have a clear purpose and usage instructions

## Adding New Scripts

When adding new scripts, place them in the appropriate category directory:

1. **Testing scripts** → `testing/`
2. **Database scripts** → `database/`
3. **Development scripts** → `development/`
4. **Utility scripts** → `utilities/`
5. **Deployment scripts** → `deployment/`

Update this README when adding new scripts to maintain documentation.
