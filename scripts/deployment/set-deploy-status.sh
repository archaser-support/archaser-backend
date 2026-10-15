#!/usr/bin/env bash
# Write public deploy-status JSON to S3 for the Amplify maintenance overlay.
# Usage:
#   bash scripts/deployment/set-deploy-status.sh \
#     --env staging|production \
#     --deploying true|false \
#     [--bucket NAME] [--prefix deploy-status] [--region REGION]
#
# Required env (or flags):
#   DEPLOY_STATUS_S3_BUCKET
# Optional:
#   DEPLOY_STATUS_S3_PREFIX (default deploy-status)
#   AWS_REGION / DEPLOY_STATUS_AWS_REGION
#   GITHUB_RUN_ID, GITHUB_SERVER_URL, GITHUB_REPOSITORY (from Actions)

set -euo pipefail

ENV_NAME=""
DEPLOYING=""
BUCKET="${DEPLOY_STATUS_S3_BUCKET:-}"
PREFIX="${DEPLOY_STATUS_S3_PREFIX:-deploy-status}"
REGION="${DEPLOY_STATUS_AWS_REGION:-${AWS_REGION:-}}"

usage() {
    sed -n '2,14p' "$0" | tr -d '#'
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env)
            ENV_NAME="${2:-}"
            shift 2
            ;;
        --deploying)
            DEPLOYING="${2:-}"
            shift 2
            ;;
        --bucket)
            BUCKET="${2:-}"
            shift 2
            ;;
        --prefix)
            PREFIX="${2:-}"
            shift 2
            ;;
        --region)
            REGION="${2:-}"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown arg: $1" >&2
            usage
            ;;
    esac
done

if [[ -z "$ENV_NAME" || -z "$DEPLOYING" ]]; then
    echo "Error: --env and --deploying are required." >&2
    usage
fi

if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "production" ]]; then
    echo "Error: --env must be staging or production (got: $ENV_NAME)" >&2
    exit 1
fi

if [[ "$DEPLOYING" != "true" && "$DEPLOYING" != "false" ]]; then
    echo "Error: --deploying must be true or false (got: $DEPLOYING)" >&2
    exit 1
fi

if [[ -z "$BUCKET" ]]; then
    echo "Warning: DEPLOY_STATUS_S3_BUCKET not set — skipping deploy-status upload." >&2
    exit 0
fi

if ! command -v aws >/dev/null 2>&1; then
    echo "Warning: aws CLI not found — skipping deploy-status upload." >&2
    exit 0
fi

# Bucket alone is not enough — configure-aws-credentials must have succeeded
# (DEPLOY_STATUS_AWS_ACCESS_KEY_ID / SECRET). Soft-skip so deploy is not blocked.
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "Warning: AWS credentials not available — skipping deploy-status upload." >&2
    echo "  Set GitHub secrets DEPLOY_STATUS_AWS_ACCESS_KEY_ID and DEPLOY_STATUS_AWS_SECRET_ACCESS_KEY." >&2
    exit 0
fi

UPDATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
RUN_ID="${GITHUB_RUN_ID:-}"
RUN_URL=""
if [[ -n "${GITHUB_SERVER_URL:-}" && -n "${GITHUB_REPOSITORY:-}" && -n "$RUN_ID" ]]; then
    RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${RUN_ID}"
fi

TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

cat >"$TMP_JSON" <<EOF
{
  "deploying": ${DEPLOYING},
  "env": "${ENV_NAME}",
  "updatedAt": "${UPDATED_AT}",
  "workflowRunId": "${RUN_ID}",
  "workflowRunUrl": "${RUN_URL}"
}
EOF

KEY="${PREFIX%/}/${ENV_NAME}.json"
S3_URI="s3://${BUCKET}/${KEY}"

AWS_ARGS=(s3 cp "$TMP_JSON" "$S3_URI"
    --content-type "application/json"
    --cache-control "no-cache, max-age=0, must-revalidate"
    --acl public-read
)

if [[ -n "$REGION" ]]; then
    AWS_ARGS+=(--region "$REGION")
fi

echo "==> Writing deploy status (${ENV_NAME} deploying=${DEPLOYING}) → ${S3_URI}"
# Prefer public-read when bucket allows ACLs; fall back without ACL for BucketOwnerEnforced.
if ! aws "${AWS_ARGS[@]}"; then
    echo "Warning: upload with --acl public-read failed; retrying without ACL..."
    AWS_ARGS=(s3 cp "$TMP_JSON" "$S3_URI"
        --content-type "application/json"
        --cache-control "no-cache, max-age=0, must-revalidate"
    )
    if [[ -n "$REGION" ]]; then
        AWS_ARGS+=(--region "$REGION")
    fi
    aws "${AWS_ARGS[@]}"
fi

echo "==> Deploy status updated"
