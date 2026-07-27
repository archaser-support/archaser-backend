#!/bin/bash

# Local Test Runner Script
# This script ensures all tests run against the local database

set -e

echo "🚀 Starting Local Test Suite"
echo "================================"

# Check if database is accessible
echo "🔍 Checking database connection..."
if ! psql postgresql://postgres:123456@localhost:5432/archaser -c "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ Database connection failed. Please ensure your local PostgreSQL is running."
    echo "   Expected connection: postgresql://postgres:123456@localhost:5432/archaser"
    exit 1
fi
echo "✅ Database connection successful"

# Check if .env.test exists and has correct configuration
if [ ! -f ".env.test" ]; then
    echo "❌ .env.test file not found. Creating from template..."
    cp env.test.example .env.test
    echo "✅ Created .env.test from template"
fi

# Verify .env.test has correct DATABASE_URL
if ! grep -q "DATABASE_URL.*localhost.*archaser" .env.test; then
    echo "⚠️  Warning: .env.test may not be configured for local database"
    echo "   Expected: DATABASE_URL with localhost:5432/archaser"
fi

echo ""
echo "🧪 Running Unit Tests (with mocked database)..."
npm run test:unit

echo ""
echo "🔗 Running Integration Tests (with real local database)..."
NODE_ENV=test npm run test:integration

echo ""
echo "🎯 Running E2E Tests..."
npm run test:e2e

echo ""
echo "✅ All tests completed successfully!"
echo "================================" 