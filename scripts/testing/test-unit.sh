#!/bin/bash

# Unit Test Runner Script
# This script ensures tests run against the local test database

echo "🧪 Starting Unit Tests with Local Database Configuration..."

# Set environment variables
export NODE_ENV=test

# Verify .env.test exists
if [ ! -f ".env.test" ]; then
    echo "❌ Error: .env.test file not found!"
    echo "Please ensure .env.test exists with local database configuration."
    exit 1
fi

# Display test environment info
echo "📋 Test Environment:"
echo "  NODE_ENV: $NODE_ENV"
echo "  DATABASE_URL: $(grep DATABASE_URL .env.test | cut -d'=' -f2 | sed 's/\/\/.*@/\/\/***:***@/')"

# Verify local database is accessible
echo "🔍 Verifying local database connection..."
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    echo "❌ Error: Local PostgreSQL database is not accessible!"
    echo "Please ensure PostgreSQL is running on localhost:5432"
    exit 1
fi

echo "✅ Local database is accessible"

# Run the tests
echo "🚀 Running unit tests..."
npm run test:unit

# Check exit code
if [ $? -eq 0 ]; then
    echo "✅ All tests passed!"
else
    echo "❌ Some tests failed!"
    exit 1
fi 