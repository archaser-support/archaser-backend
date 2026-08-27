#!/usr/bin/env bash
# Slice 2 — lambda-promtail CloudWatch → Loki pipeline
# Downloads Grafana lambda-promtail zip, uploads to S3, deploys CloudFormation.
#
# Required env (or source params.production.env / params.staging.env):
#   ENVIRONMENT=production|staging
#   WRITE_ADDRESS=http://<ec2-private-ip>:3100/loki/api/v1/push
#   RDS_LOG_GROUP=/aws/rds/instance/<id>/postgresql
#   VPC_ID=vpc-...
#   PRIVATE_SUBNET_IDS=subnet-aaa,subnet-bbb
#   LOKI_SECURITY_GROUP_ID=sg-...
#   S3_BUCKET=your-artifacts-artifacts-bucket
#
# Optional:
#   AWS_REGION=eu-north-1
#   S3_KEY=lambda-promtail/lambda-promtail-v1.0.0.zip
#   LAMBDA_PROMTAIL_VERSION=v1.0.0
#   PARAMS_FILE=./params.production.env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "${PARAMS_FILE:-}" ]]; then
  # shellcheck disable=SC1090
  source "${PARAMS_FILE}"
fi

REGION="${AWS_REGION:-eu-north-1}"
ENVIRONMENT="${ENVIRONMENT:?Set ENVIRONMENT=production|staging}"
STACK_NAME="${STACK_NAME:-archaser-lambda-promtail-${ENVIRONMENT}}"
WRITE_ADDRESS="${WRITE_ADDRESS:?Set WRITE_ADDRESS to Loki private push URL}"
RDS_LOG_GROUP="${RDS_LOG_GROUP:?Set RDS_LOG_GROUP}"
VPC_ID="${VPC_ID:?Set VPC_ID}"
PRIVATE_SUBNET_IDS="${PRIVATE_SUBNET_IDS:?Set PRIVATE_SUBNET_IDS (comma-separated)}"
LOKI_SECURITY_GROUP_ID="${LOKI_SECURITY_GROUP_ID:?Set LOKI_SECURITY_GROUP_ID}"
S3_BUCKET="${S3_BUCKET:?Set S3_BUCKET for the lambda zip}"
VERSION="${LAMBDA_PROMTAIL_VERSION:-v1.0.0}"
S3_KEY="${S3_KEY:-lambda-promtail/lambda-promtail-${VERSION}.zip}"
ZIP_URL="https://github.com/grafana/lambda-promtail/releases/download/${VERSION}/lambda-promtail-${VERSION}.zip"
# Default jsonlog stages — extract error_severity as a Loki label
DEFAULT_STAGES='[{"json":{"expressions":{"error_severity":"error_severity"}}},{"labels":{"error_severity":""}}]'
LOKI_STAGE_CONFIGS="${LOKI_STAGE_CONFIGS:-$DEFAULT_STAGES}"

if ! command -v aws >/dev/null 2>&1; then
  echo "Error: AWS CLI is required."
  exit 1
fi

echo "========================================="
echo "ARChaser lambda-promtail (slice 2)"
echo "========================================="
echo "  Region:      ${REGION}"
echo "  Environment: ${ENVIRONMENT}"
echo "  Stack:       ${STACK_NAME}"
echo "  Write addr:  ${WRITE_ADDRESS}"
echo "  Log group:   ${RDS_LOG_GROUP}"
echo "  S3:          s3://${S3_BUCKET}/${S3_KEY}"
echo ""

TMP_ZIP="$(mktemp -t lambda-promtail-XXXXXX.zip)"
PARAMS_JSON="$(mktemp -t lambda-promtail-params-XXXXXX.json)"
cleanup() { rm -f "${TMP_ZIP}" "${PARAMS_JSON}"; }
trap cleanup EXIT

echo "→ Downloading ${ZIP_URL}..."
curl -fsSL -o "${TMP_ZIP}" "${ZIP_URL}"

echo "→ Uploading to s3://${S3_BUCKET}/${S3_KEY}..."
aws s3 cp "${TMP_ZIP}" "s3://${S3_BUCKET}/${S3_KEY}" --region "${REGION}"

# Escape JSON string for CloudFormation ParameterValue
STAGES_ESCAPED="${LOKI_STAGE_CONFIGS//\\/\\\\}"
STAGES_ESCAPED="${STAGES_ESCAPED//\"/\\\"}"

cat > "${PARAMS_JSON}" <<EOF
[
  {"ParameterKey":"Environment","ParameterValue":"${ENVIRONMENT}"},
  {"ParameterKey":"WriteAddress","ParameterValue":"${WRITE_ADDRESS}"},
  {"ParameterKey":"RdsLogGroupName","ParameterValue":"${RDS_LOG_GROUP}"},
  {"ParameterKey":"VpcId","ParameterValue":"${VPC_ID}"},
  {"ParameterKey":"PrivateSubnetIds","ParameterValue":"${PRIVATE_SUBNET_IDS}"},
  {"ParameterKey":"LokiSecurityGroupId","ParameterValue":"${LOKI_SECURITY_GROUP_ID}"},
  {"ParameterKey":"S3BucketName","ParameterValue":"${S3_BUCKET}"},
  {"ParameterKey":"S3KeyName","ParameterValue":"${S3_KEY}"},
  {"ParameterKey":"LokiStageConfigs","ParameterValue":"${STAGES_ESCAPED}"}
]
EOF

echo "→ Deploying CloudFormation stack..."
if aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --region "${REGION}" >/dev/null 2>&1; then
  aws cloudformation update-stack \
    --stack-name "${STACK_NAME}" \
    --template-body "file://${SCRIPT_DIR}/cloudformation-lambda-promtail.yaml" \
    --parameters "file://${PARAMS_JSON}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "${REGION}" || true
  echo "Waiting for stack update..."
  aws cloudformation wait stack-update-complete --stack-name "${STACK_NAME}" --region "${REGION}" 2>/dev/null || true
else
  aws cloudformation create-stack \
    --stack-name "${STACK_NAME}" \
    --template-body "file://${SCRIPT_DIR}/cloudformation-lambda-promtail.yaml" \
    --parameters "file://${PARAMS_JSON}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "${REGION}"
  echo "Waiting for stack create..."
  aws cloudformation wait stack-create-complete --stack-name "${STACK_NAME}" --region "${REGION}"
fi

echo ""
echo "→ Ensuring CloudWatch retention is 3–7 days on ${RDS_LOG_GROUP}..."
aws logs put-retention-policy \
  --log-group-name "${RDS_LOG_GROUP}" \
  --retention-in-days "${RETENTION_DAYS:-5}" \
  --region "${REGION}" || true

echo ""
aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs' \
  --output table

echo ""
echo "========================================="
echo "Slice 2 deploy complete."
echo "Validate in Grafana Explore:"
echo "  {job=\"rds-postgres\", environment=\"${ENVIRONMENT}\"} | json"
echo "Then confirm subscription filter Invocations in CloudWatch metrics."
echo "========================================="
