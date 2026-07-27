#!/bin/bash

# Development script that runs both the dev server and logout tests in watch mode
# This ensures logout tests run automatically when code changes

echo "🚀 Starting development environment with automatic logout tests..."

# Function to cleanup background processes on exit
cleanup() {
    echo "🛑 Shutting down development environment..."
    kill $DEV_PID $TEST_PID 2>/dev/null
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Start the development server in the background
echo "📡 Starting Next.js development server..."
npm run dev &
DEV_PID=$!

# Wait a moment for the dev server to start
sleep 3

# Start logout tests in watch mode
echo "🧪 Starting logout tests in watch mode..."
npm run test:logout:watch &
TEST_PID=$!

echo "✅ Development environment ready!"
echo "   - Dev server: http://localhost:3000"
echo "   - Logout tests: Running in watch mode"
echo "   - Press Ctrl+C to stop both"

# Wait for both processes
wait 