#!/usr/bin/env bash
# One-shot: create public deploy-status S3 bucket + seed JSON + CORS.
#
# Usage:
#   bash scripts/deployment/setup-deploy-status-bucket.sh
#   bash scripts/deployment/setup-deploy-status-bucket.sh --bucket archaser-deploy-status --region eu-north-1
#
# Requires: aws CLI authenticated (aws sts get-caller-identity).

set -euo pipefail

BUCKET="${DEPLOY_STATUS_S3_BUCKET:-archaser-deploy-status}"
REGION="${DEPLOY_STATUS_AWS_REGION:-${AWS_REGION:-eu-north-1}}"
PREFIX="deploy-status"
UPDATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bucket) BUCKET="${2:-}"; shift 2 ;;
        --region) REGION="${2:-}"; shift 2 ;;
        -h|--help)
            sed -n '2,10p' "$0" | tr -d '#'
            exit 0
            ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

echo "==> Caller identity"
aws sts get-caller-identity

echo "==> Ensuring bucket s3://${BUCKET} in ${REGION}"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    echo "Bucket already exists"
else
    if [[ "$REGION" == "us-east-1" ]]; then
        aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
    else
        aws s3api create-bucket \
            --bucket "$BUCKET" \
            --region "$REGION" \
            --create-bucket-configuration "LocationConstraint=${REGION}"
    fi
fi

echo "==> Public access block (allow policies; keep ACLs blocked if preferred)"
aws s3api put-public-access-block \
    --bucket "$BUCKET" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"

echo "==> Bucket policy — public GetObject on ${PREFIX}/*"
POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadDeployStatus",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${BUCKET}/${PREFIX}/*"
    }
  ]
}
EOF
)
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$POLICY"

echo "==> CORS for Amplify UI hosts"
CORS=$(cat <<'EOF'
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "https://staging.archaser.com",
        "https://www.staging.archaser.com",
        "https://portal.archaser.com",
        "https://www.portal.archaser.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
      ],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "Content-Type"],
      "MaxAgeSeconds": 300
    }
  ]
}
EOF
)
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "$CORS"

seed_file() {
    local env_name="$1"
    local tmp
    tmp="$(mktemp)"
    cat >"$tmp" <<EOF
{
  "deploying": false,
  "env": "${env_name}",
  "updatedAt": "${UPDATED_AT}",
  "workflowRunId": "",
  "workflowRunUrl": ""
}
EOF
    aws s3 cp "$tmp" "s3://${BUCKET}/${PREFIX}/${env_name}.json" \
        --region "$REGION" \
        --content-type "application/json" \
        --cache-control "no-cache, max-age=0, must-revalidate"
    rm -f "$tmp"
}

echo "==> Seeding status JSON"
seed_file staging
seed_file production

BASE_URL="https://${BUCKET}.s3.${REGION}.amazonaws.com/${PREFIX}"
echo ""
echo "Done."
echo "  Public base URL (use as NEXT_PUBLIC_DEPLOY_STATUS_BASE_URL):"
echo "    ${BASE_URL}"
echo "  Smoke:"
echo "    curl -sS ${BASE_URL}/staging.json"
echo "    curl -sS ${BASE_URL}/production.json"
echo ""
echo "  GHA secrets still needed:"
echo "    DEPLOY_STATUS_S3_BUCKET=${BUCKET}"
echo "    DEPLOY_STATUS_AWS_ACCESS_KEY_ID=..."
echo "    DEPLOY_STATUS_AWS_SECRET_ACCESS_KEY=..."
echo "    DEPLOY_STATUS_AWS_REGION=${REGION}"
