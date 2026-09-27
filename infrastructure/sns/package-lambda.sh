#!/bin/bash
# Package infrastructure/sns/lambda into a zip for AWS Lambda update-function-code.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="$SCRIPT_DIR/lambda"
DIST_DIR="$SCRIPT_DIR/dist"
ZIP_PATH="$DIST_DIR/alert-webhook.zip"

mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

echo "📦 Installing Lambda dependencies..."
(
  cd "$LAMBDA_DIR"
  npm install --omit=dev --no-fund --no-audit >/dev/null
)

echo "📦 Creating $ZIP_PATH ..."
(
  cd "$LAMBDA_DIR"
  zip -qr "$ZIP_PATH" . \
    -x "*.test.js" \
    -x "*_parts.js" \
    -x "*/.DS_Store"
)

echo "✅ Packaged $(wc -c < "$ZIP_PATH" | tr -d ' ') bytes"
