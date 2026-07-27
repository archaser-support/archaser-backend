#!/usr/bin/env bash
# Slice 1 — RDS PostgreSQL logging + CloudWatch export
# Deploys the custom parameter group, attaches it with ApplyImmediately=false
# (maintenance-window reboot), enables postgresql CloudWatch export, sets retention.
#
# Usage:
#   export RDS_INSTANCE_ID=your-prod-instance
#   export ENVIRONMENT=production
#   export FAMILY=postgres16          # must match engine major
#   export LOG_DESTINATION=jsonlog    # or stderr if engine < 15
#   ./configure-rds-logging.sh
#
# Optional:
#   SLOW_QUERY_MS=1000
#   RETENTION_DAYS=5                  # 3–7
#   AWS_REGION=eu-north-1
#   APPLY_IMMEDIATELY=false           # never true for production unless approved

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGION="${AWS_REGION:-eu-north-1}"
ENVIRONMENT="${ENVIRONMENT:-production}"
STACK_NAME="${STACK_NAME:-archaser-rds-logging-${ENVIRONMENT}}"
RDS_INSTANCE_ID="${RDS_INSTANCE_ID:?Set RDS_INSTANCE_ID to the target RDS instance identifier}"
FAMILY="${FAMILY:-postgres16}"
LOG_DESTINATION="${LOG_DESTINATION:-jsonlog}"
SLOW_QUERY_MS="${SLOW_QUERY_MS:-1000}"
RETENTION_DAYS="${RETENTION_DAYS:-5}"
APPLY_IMMEDIATELY="${APPLY_IMMEDIATELY:-false}"

if ! command -v aws >/dev/null 2>&1; then
  echo "Error: AWS CLI is required."
  exit 1
fi

if [[ "$RETENTION_DAYS" -lt 3 || "$RETENTION_DAYS" -gt 7 ]]; then
  echo "Error: RETENTION_DAYS must be 3–7 (got ${RETENTION_DAYS})"
  exit 1
fi

echo "========================================="
echo "ARChaser RDS PostgreSQL logging (slice 1)"
echo "========================================="
echo "  Region:           ${REGION}"
echo "  Environment:      ${ENVIRONMENT}"
echo "  Stack:            ${STACK_NAME}"
echo "  RDS instance:     ${RDS_INSTANCE_ID}"
echo "  Family:           ${FAMILY}"
echo "  log_destination:  ${LOG_DESTINATION}"
echo "  Slow query ms:    ${SLOW_QUERY_MS}"
echo "  CW retention:     ${RETENTION_DAYS} days"
echo "  ApplyImmediately: ${APPLY_IMMEDIATELY}"
echo ""

ENGINE_VERSION="$(aws rds describe-db-instances \
  --db-instance-identifier "${RDS_INSTANCE_ID}" \
  --region "${REGION}" \
  --query 'DBInstances[0].EngineVersion' \
  --output text)"
MAJOR="${ENGINE_VERSION%%.*}"
echo "Detected engine version: ${ENGINE_VERSION} (major ${MAJOR})"

if [[ "${LOG_DESTINATION}" == "jsonlog" && "${MAJOR}" -lt 15 ]]; then
  echo ""
  echo "WARNING: jsonlog requires Postgres >= 15. This instance is ${ENGINE_VERSION}."
  echo "Redeploy with LOG_DESTINATION=stderr (fallback path documented in README)."
  exit 1
fi

echo ""
echo "→ Deploying parameter group stack..."
if aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --region "${REGION}" >/dev/null 2>&1; then
  aws cloudformation update-stack \
    --stack-name "${STACK_NAME}" \
    --template-body "file://${SCRIPT_DIR}/cloudformation-rds-logging.yaml" \
    --parameters \
      "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}" \
      "ParameterKey=Family,ParameterValue=${FAMILY}" \
      "ParameterKey=LogDestination,ParameterValue=${LOG_DESTINATION}" \
      "ParameterKey=SlowQueryMs,ParameterValue=${SLOW_QUERY_MS}" \
    --region "${REGION}" || true
  aws cloudformation wait stack-update-complete --stack-name "${STACK_NAME}" --region "${REGION}" 2>/dev/null || true
else
  aws cloudformation create-stack \
    --stack-name "${STACK_NAME}" \
    --template-body "file://${SCRIPT_DIR}/cloudformation-rds-logging.yaml" \
    --parameters \
      "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}" \
      "ParameterKey=Family,ParameterValue=${FAMILY}" \
      "ParameterKey=LogDestination,ParameterValue=${LOG_DESTINATION}" \
      "ParameterKey=SlowQueryMs,ParameterValue=${SLOW_QUERY_MS}" \
    --region "${REGION}"
  aws cloudformation wait stack-create-complete --stack-name "${STACK_NAME}" --region "${REGION}"
fi

PG_NAME="$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='ParameterGroupName'].OutputValue" \
  --output text)"

echo "Parameter group: ${PG_NAME}"

CURRENT_PG="$(aws rds describe-db-instances \
  --db-instance-identifier "${RDS_INSTANCE_ID}" \
  --region "${REGION}" \
  --query 'DBInstances[0].DBParameterGroups[0].DBParameterGroupName' \
  --output text)"

if [[ "${CURRENT_PG}" != "${PG_NAME}" ]]; then
  echo "→ Attaching parameter group (ApplyImmediately=${APPLY_IMMEDIATELY})..."
  aws rds modify-db-instance \
    --db-instance-identifier "${RDS_INSTANCE_ID}" \
    --db-parameter-group-name "${PG_NAME}" \
    --apply-immediately "${APPLY_IMMEDIATELY}" \
    --region "${REGION}" >/dev/null
  echo "Attached. If status shows pending-reboot, wait for the next maintenance window."
else
  echo "Parameter group already attached."
fi

echo "→ Enabling CloudWatch Logs export for postgresql (no reboot)..."
aws rds modify-db-instance \
  --db-instance-identifier "${RDS_INSTANCE_ID}" \
  --cloudwatch-logs-export-configuration "EnableLogTypes=postgresql" \
  --apply-immediately true \
  --region "${REGION}" >/dev/null

LOG_GROUP="/aws/rds/instance/${RDS_INSTANCE_ID}/postgresql"
echo "→ Setting CloudWatch retention on ${LOG_GROUP} to ${RETENTION_DAYS} days..."
# Log group appears after export is enabled and the instance emits logs.
aws logs create-log-group --log-group-name "${LOG_GROUP}" --region "${REGION}" 2>/dev/null || true
aws logs put-retention-policy \
  --log-group-name "${LOG_GROUP}" \
  --retention-in-days "${RETENTION_DAYS}" \
  --region "${REGION}"

echo ""
echo "Verifying log_statement is not 'all'..."
aws rds describe-db-parameters \
  --db-parameter-group-name "${PG_NAME}" \
  --region "${REGION}" \
  --query "Parameters[?ParameterName=='log_statement'].[ParameterName,ParameterValue]" \
  --output table

echo ""
echo "========================================="
echo "Slice 1 complete (config applied)."
echo "Next:"
echo "  1. Confirm pending-reboot params are scheduled for the maintenance window"
echo "     (do NOT reboot ad hoc unless explicitly approved)."
echo "  2. After reboot (if required), confirm events in ${LOG_GROUP}"
echo "  3. Deploy slice 2: ./deploy-lambda-promtail.sh"
echo "========================================="
