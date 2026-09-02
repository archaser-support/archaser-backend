#!/bin/bash

# Report Builder Test Script
# This script tests the report builder by creating numerous reports with different configurations
# and verifying they return data correctly.

set -e

echo "🧪 Starting Report Builder Tests..."
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Check if NEXTAUTH_URL is set
if [ -z "$NEXTAUTH_URL" ]; then
    echo "⚠️  Warning: NEXTAUTH_URL not set, using default: http://localhost:3000"
    export NEXTAUTH_URL="http://localhost:3000"
fi

# Check if TEST_EMAIL is set
if [ -z "$TEST_EMAIL" ]; then
    echo "⚠️  Warning: TEST_EMAIL not set, using default: admin@example.com"
    echo "   Set TEST_EMAIL environment variable to use a different email"
    export TEST_EMAIL="admin@example.com"
fi

# Check if TEST_PASSWORD is set
if [ -z "$TEST_PASSWORD" ]; then
    echo "❌ Error: TEST_PASSWORD is required."
    echo "   Set TEST_PASSWORD in the environment before running this script."
    exit 1
fi

echo "📊 Configuration:"
echo "   NEXTAUTH_URL: $NEXTAUTH_URL"
echo "   TEST_EMAIL: $TEST_EMAIL"
echo "   TEST_PASSWORD: [hidden]"
echo ""

# Check if server is accessible
echo "🔍 Checking server connection..."
if ! curl -s -f "$NEXTAUTH_URL/api/auth/session" > /dev/null 2>&1; then
    echo "❌ Error: Cannot connect to server at $NEXTAUTH_URL"
    echo "   Please ensure:"
    echo "   1. The Next.js server is running (npm run dev)"
    echo "   2. NEXTAUTH_URL is correct"
    exit 1
fi

echo "✅ Server connection successful"
echo ""

# Run the test script
echo "🚀 Running report builder tests..."
echo ""

npx tsx scripts/testing/test-report-builder.ts

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ All report builder tests completed successfully!"
else
    echo ""
    echo "❌ Some tests failed. Check the output above for details."
    exit $EXIT_CODE
fi

