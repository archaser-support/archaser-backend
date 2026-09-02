#!/bin/bash

# Quick wrapper script to run penetration tests with authentication
# Usage: ./scripts/security/run-penetration-test.sh

echo "Archaser Penetration Testing with Authentication"
echo "================================================"
echo ""
echo "Please provide test credentials:"
echo ""

read -p "Email: " TEST_EMAIL
read -sp "Password: " TEST_PASSWORD
echo ""

export TEST_EMAIL="dori.stopper+88@gmail.com"
export TEST_PASSWORD="Dori@1971"

echo ""
echo "Running penetration tests..."
echo ""

./scripts/security/penetration-test.sh \
  -u "${BASE_URL:-http://localhost:3000}" \
  -e "$TEST_EMAIL" \
  -p "$TEST_PASSWORD" \
  -v

