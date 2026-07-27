#!/bin/bash

# Portal Test Watcher Script
# This script runs portal tests in watch mode and provides helpful feedback

echo "🚀 Starting Portal Test Watcher..."
echo "📁 Watching for changes in:"
echo "   - app/[locale]/portal/"
echo "   - pages/api/portal/"
echo "   - pages/api/invoices/portal.ts"
echo "   - server/services/"
echo "   - test/unit/portal/"
echo ""
echo "Press Ctrl+C to stop watching"
echo ""

# Run portal tests in watch mode
npm run test:portal:watch 