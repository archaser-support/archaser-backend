#!/bin/bash

# Quick wrapper script to run penetration tests with authentication
# Usage:
#   TEST_EMAIL=user@example.com TEST_PASSWORD=secret ./scripts/security/run-penetration-test.sh
# Or run without env vars to be prompted interactively.

set -euo pipefail

echo "Archaser Penetration Testing with Authentication"
echo "================================================"
echo ""

if [ -z "${TEST_EMAIL:-}" ]; then
    read -r -p "Email: " TEST_EMAIL
fi
if [ -z "${TEST_PASSWORD:-}" ]; then
    read -r -sp "Password: " TEST_PASSWORD
    echo ""
fi

if [ -z "${TEST_EMAIL:-}" ] || [ -z "${TEST_PASSWORD:-}" ]; then
    echo "Error: TEST_EMAIL and TEST_PASSWORD are required."
    echo "Set them in the environment or enter them when prompted."
    exit 1
fi

export TEST_EMAIL TEST_PASSWORD

echo ""
echo "Running penetration tests..."
echo ""

./scripts/security/penetration-test.sh \
  -u "${BASE_URL:-http://localhost:3000}" \
  -e "$TEST_EMAIL" \
  -p "$TEST_PASSWORD" \
  -v
