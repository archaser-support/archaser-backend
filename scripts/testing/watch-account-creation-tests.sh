#!/bin/bash

# Watch Account Creation Tests Script
# This script watches for changes in account creation related files and runs tests automatically

set -e

echo "👀 Starting Account Creation Test Watcher..."
echo "📁 Watching for changes in:"
echo "   - server/services/CustomerService.ts"
echo "   - pages/api/admin/accounts/"
echo "   - app/[locale]/app/admin/accounts/"
echo "   - test/unit/services/CustomerService.test.ts"
echo "   - test/unit/api/account-creation.test.ts"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "⚠️  Warning: DATABASE_URL not set, using default test database"
    export DATABASE_URL="postgresql://postgres:password@localhost:5432/archaser_test"
fi

echo "📊 Using database: $DATABASE_URL"

# Check if database is accessible
echo "🔍 Checking database connection..."
if ! npx prisma db execute --stdin <<< "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ Error: Cannot connect to database. Please ensure:"
    echo "   1. Database server is running"
    echo "   2. DATABASE_URL is correct"
    echo "   3. Database exists and is accessible"
    exit 1
fi

echo "✅ Database connection successful"
echo ""

# Function to run tests
run_tests() {
    echo "🧪 Running account creation tests..."
    echo "⏰ $(date '+%H:%M:%S')"
    echo "----------------------------------------"
    
    # Run the tests
    if npm run test:account-creation; then
        echo "✅ Tests passed!"
    else
        echo "❌ Tests failed!"
        echo "🔔 Tests failed at $(date '+%H:%M:%S')"
    fi
    
    echo "----------------------------------------"
    echo ""
}

# Run initial test
echo "🚀 Running initial test..."
run_tests

# Watch for file changes
echo "👀 Watching for file changes..."
echo "Press Ctrl+C to stop watching"
echo ""

# Use fswatch if available, otherwise use inotifywait or fallback to polling
if command -v fswatch >/dev/null 2>&1; then
    # macOS with fswatch
    fswatch -o \
        server/services/CustomerService.ts \
        pages/api/admin/accounts/ \
        app/\[locale\]/app/admin/accounts/ \
        test/unit/services/CustomerService.test.ts \
        test/unit/api/account-creation.test.ts \
        test/integration/account-creation-activity-sequences.test.ts \
    | while read f; do
        run_tests
    done
elif command -v inotifywait >/dev/null 2>&1; then
    # Linux with inotifywait
    while true; do
        inotifywait -r -e modify,create,delete \
            server/services/CustomerService.ts \
            pages/api/admin/accounts/ \
            app/\[locale\]/app/admin/accounts/ \
            test/unit/services/CustomerService.test.ts \
            test/unit/api/account-creation.test.ts \
            test/integration/account-creation-activity-sequences.test.ts \
        && run_tests
    done
else
    # Fallback to polling (works everywhere)
    echo "⚠️  No file watcher found, using polling (checking every 5 seconds)"
    while true; do
        sleep 5
        # Check if any watched files have been modified in the last 5 seconds
        if find server/services/CustomerService.ts \
                  pages/api/admin/accounts/ \
                  app/\[locale\]/app/admin/accounts/ \
                  test/unit/services/CustomerService.test.ts \
                  test/unit/api/account-creation.test.ts \
                  test/integration/account-creation-activity-sequences.test.ts \
            -newermt "5 seconds ago" 2>/dev/null | grep -q .; then
            run_tests
        fi
    done
fi 