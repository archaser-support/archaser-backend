#!/bin/bash

# Development with Account Creation Tests Script
# This script runs the development server and watches for account creation changes

set -e

echo "🚀 Starting Development Server with Account Creation Test Watcher..."
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
run_account_tests() {
    echo "🧪 Running account creation tests..."
    echo "⏰ $(date '+%H:%M:%S')"
    echo "----------------------------------------"
    
    if npm run test:account-creation > /dev/null 2>&1; then
        echo "✅ Account creation tests passed!"
    else
        echo "❌ Account creation tests failed!"
        echo "🔔 Tests failed at $(date '+%H:%M:%S')"
        echo "💡 Run 'npm run test:account-creation' for detailed output"
    fi
    
    echo "----------------------------------------"
    echo ""
}

# Run initial test
echo "🚀 Running initial account creation test..."
run_account_tests

# Start the development server in the background
echo "🌐 Starting Next.js development server..."
npm run dev &
DEV_PID=$!

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down development server..."
    kill $DEV_PID 2>/dev/null || true
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo "✅ Development server started (PID: $DEV_PID)"
echo "🌐 Server running at: http://localhost:3000"
echo ""
echo "👀 Watching for account creation file changes..."
echo "Press Ctrl+C to stop"
echo ""

# Watch for file changes using fswatch if available
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
        run_account_tests
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
        && run_account_tests
    done
else
    # Fallback to polling
    echo "⚠️  No file watcher found, using polling (checking every 10 seconds)"
    while true; do
        sleep 10
        # Check if any watched files have been modified in the last 10 seconds
        if find server/services/CustomerService.ts \
                  pages/api/admin/accounts/ \
                  app/\[locale\]/app/admin/accounts/ \
                  test/unit/services/CustomerService.test.ts \
                  test/unit/api/account-creation.test.ts \
                  test/integration/account-creation-activity-sequences.test.ts \
            -newermt "10 seconds ago" 2>/dev/null | grep -q .; then
            run_account_tests
        fi
    done
fi 