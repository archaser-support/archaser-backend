#!/bin/bash

# Test Account Creation Script
# This script runs the account creation tests with proper database setup

set -e

echo "🧪 Starting Account Creation Tests..."

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

# Run the CustomerService tests
echo "🧪 Running CustomerService tests..."
npx vitest run test/unit/services/CustomerService.test.ts --reporter=verbose

# Run the API endpoint tests
echo "🧪 Running API endpoint tests..."
npx vitest run test/unit/api/account-creation.test.ts --reporter=verbose

# Run integration tests
echo "🧪 Running integration tests..."
npx vitest run test/integration/account-creation-activity-sequences.test.ts --reporter=verbose

echo "✅ All account creation tests completed successfully!"
echo ""
echo "📋 Test Summary:"
echo "   - CustomerService unit tests"
echo "   - API endpoint unit tests"
echo "   - Integration tests"
echo ""
echo "🎉 Account creation functionality is working correctly!" 