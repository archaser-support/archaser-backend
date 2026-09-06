#!/usr/bin/env bash
# End-to-end validation checklist for Postgres logs → Grafana
# Prints checks; run each command manually against the target environment.

set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-production}"
RDS_INSTANCE_ID="${RDS_INSTANCE_ID:-<set-me>}"
RDS_LOG_GROUP="${RDS_LOG_GROUP:-/aws/rds/instance/${RDS_INSTANCE_ID}/postgresql}"
REGION="${AWS_REGION:-eu-north-1}"
LAMBDA_NAME="${LAMBDA_NAME:-archaser-lambda-promtail-${ENVIRONMENT}}"

cat <<EOF
=========================================
Postgres logs → Grafana validation
Environment: ${ENVIRONMENT}
=========================================

[ ] 1. RDS parameter group attached; pending-reboot only via maintenance window
    aws rds describe-db-instances --db-instance-identifier ${RDS_INSTANCE_ID} --region ${REGION} \\
      --query 'DBInstances[0].{PG:DBParameterGroups,Exports:EnabledCloudwatchLogsExports,Engine:EngineVersion}'

[ ] 2. log_statement is not all
    aws rds describe-db-parameters --db-parameter-group-name <pg-name> --region ${REGION} \\
      --query "Parameters[?ParameterName=='log_statement']"

[ ] 3. CloudWatch log group receives events
    aws logs describe-log-streams --log-group-name ${RDS_LOG_GROUP} --order-by LastEventTime --descending --limit 3 --region ${REGION}

[ ] 4. Retention is 3–7 days
    aws logs describe-log-groups --log-group-name-prefix ${RDS_LOG_GROUP} --region ${REGION} \\
      --query 'logGroups[0].retentionInDays'

[ ] 5. Subscription filter → Lambda invocations
    aws logs describe-subscription-filters --log-group-name ${RDS_LOG_GROUP} --region ${REGION}
    # CloudWatch → Metrics → Lambda → Invocations for ${LAMBDA_NAME}

[ ] 6. Loki Explore
    {job="rds-postgres", environment="${ENVIRONMENT}"} | json
    {job="rds-postgres", environment="${ENVIRONMENT}", error_severity="ERROR"}

[ ] 7. Benign generators (against a safe connection)
    -- Slow query (>1000ms):  SELECT pg_sleep(1.5);
    -- Benign error:          SELECT 1/0;
    Confirm both appear in Loki within a few minutes.

[ ] 8. Grafana dashboard "Postgres Logs - ${ENVIRONMENT}" panels populate

[ ] 9. Alerts (production only pages SNS)
    FATAL/PANIC rule and ERROR-rate rule exist under folder matching ${ENVIRONMENT}.
    Staging must use silent-staging receiver (no production SNS).

[ ] 10. Port 3100 not public
    From outside the VPC: nc -vz <public-ip> 3100  → must fail
    Lambda SG → Loki SG on 3100 only.

EOF
