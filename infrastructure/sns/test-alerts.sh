#!/bin/bash
# Test SNS Alert Integration
# Run this script after deploying the CloudFormation stack

set -e

REGION="${AWS_REGION:-eu-north-1}"
STACK_NAME="archaser-alert-sns"

echo "========================================="
echo "Testing ARChaser SNS Alert Integration"
echo "========================================="
echo ""

# Get the webhook URL from CloudFormation
WEBHOOK_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='WebhookUrl'].OutputValue" \
    --output text \
    --region $REGION 2>/dev/null)

if [ -z "$WEBHOOK_URL" ] || [ "$WEBHOOK_URL" == "None" ]; then
    echo "❌ Error: Could not get webhook URL. Make sure the stack is deployed."
    echo "   Run: ./deploy.sh first"
    exit 1
fi

echo "📍 Webhook URL: $WEBHOOK_URL"
echo ""

RUN_ID="${RUN_ID:-test-$(date +%s)}"
CRITICAL_ALERT_NAME="TestCritical-${RUN_ID}"
DIGEST_GROUP_NAME="TestDigest-${RUN_ID}"
echo "🏷️  Run ID: $RUN_ID"
echo ""

assert_response_field() {
    local response="$1"
    local field="$2"
    local expected="$3"
    local label="$4"

    if command -v jq >/dev/null 2>&1; then
        local actual
        actual=$(echo "$response" | jq -r ".$field // empty")
        if [ "$actual" = "$expected" ]; then
            echo "✅ $label: $actual"
            return 0
        fi
        echo "❌ $label: expected '$expected', got '$actual'"
        echo "   Response: $response"
        exit 1
    fi

    if echo "$response" | grep -q "\"$field\":\"$expected\""; then
        echo "✅ $label: $expected"
        return 0
    fi
    echo "❌ $label: expected '$expected' in response"
    echo "   Response: $response"
    exit 1
}

assert_subject_contains() {
    local response="$1"
    local pattern="$2"
    local label="$3"

    if command -v jq >/dev/null 2>&1; then
        local subject
        subject=$(echo "$response" | jq -r '.subject // empty')
        if echo "$subject" | grep -q "$pattern"; then
            echo "✅ $label: $subject"
            return 0
        fi
        echo "❌ $label: subject '$subject' missing pattern '$pattern'"
        exit 1
    fi

    if echo "$response" | grep -q "$pattern"; then
        echo "✅ $label: contains '$pattern'"
        return 0
    fi
    echo "❌ $label: response missing pattern '$pattern'"
    echo "   Response: $response"
    exit 1
}

post_alert() {
    local payload="$1"
    curl -s -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "$payload"
}

# Single critical alert — immediate paging style
CRITICAL_FIRING_PAYLOAD=$(cat <<EOF
{
  "status": "firing",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "${CRITICAL_ALERT_NAME}",
        "severity": "critical",
        "grafana_folder": "Production"
      },
      "annotations": {
        "summary": "PostgreSQL database connection lost",
        "description": "The application cannot connect to PostgreSQL."
      },
      "startsAt": "2026-06-29T10:00:00Z",
      "generatorURL": "https://grafana.archaser.com/alerting/list"
    }
  ],
  "groupLabels": {
    "alertname": "${CRITICAL_ALERT_NAME}"
  },
  "commonLabels": {
    "alertname": "${CRITICAL_ALERT_NAME}",
    "severity": "critical"
  }
}
EOF
)

CRITICAL_RESOLVED_PAYLOAD=$(cat <<EOF
{
  "status": "resolved",
  "alerts": [
    {
      "status": "resolved",
      "labels": {
        "alertname": "${CRITICAL_ALERT_NAME}",
        "severity": "critical",
        "grafana_folder": "Production"
      },
      "annotations": {
        "summary": "PostgreSQL database connection lost",
        "description": "The application cannot connect to PostgreSQL."
      },
      "startsAt": "2026-06-29T10:00:00Z",
      "endsAt": "2026-06-29T10:15:00Z",
      "generatorURL": "https://grafana.archaser.com/alerting/list"
    }
  ],
  "groupLabels": {
    "alertname": "${CRITICAL_ALERT_NAME}"
  },
  "commonLabels": {
    "alertname": "${CRITICAL_ALERT_NAME}",
    "severity": "critical"
  }
}
EOF
)

# Batched high/medium digest — grouped notification style
DIGEST_FIRING_PAYLOAD=$(cat <<EOF
{
  "status": "firing",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "Stuck Activities Detected",
        "severity": "high",
        "grafana_folder": "Production"
      },
      "annotations": {
        "summary": "Activities stuck in processing state",
        "description": "One or more activities have been stuck for over 2 hours."
      },
      "startsAt": "2026-06-29T10:00:00Z"
    },
    {
      "status": "firing",
      "labels": {
        "alertname": "Cron Jobs Overdue",
        "severity": "medium",
        "grafana_folder": "Production"
      },
      "annotations": {
        "summary": "Cron jobs are overdue",
        "description": "Scheduled cron jobs have not run on time."
      },
      "startsAt": "2026-06-29T10:05:00Z"
    },
    {
      "status": "firing",
      "labels": {
        "alertname": "High Email Bounce Rate",
        "severity": "medium",
        "grafana_folder": "Production"
      },
      "annotations": {
        "summary": "Elevated email bounce rate in the last 24 hours",
        "description": "More than the threshold of emails bounced."
      },
      "startsAt": "2026-06-29T10:10:00Z"
    }
  ],
  "groupLabels": {
    "alertname": "${DIGEST_GROUP_NAME}"
  },
  "commonLabels": {
    "grafana_folder": "Production"
  }
}
EOF
)

echo "🔥 Test 1: Critical single-alert (firing)..."
RESPONSE=$(post_alert "$CRITICAL_FIRING_PAYLOAD")
echo "Response: $RESPONSE"
assert_response_field "$RESPONSE" "deliveryTier" "critical" "Delivery tier"
assert_subject_contains "$RESPONSE" "\[CRITICAL\]" "Critical subject prefix"
echo ""

echo "⏳ Waiting 3 seconds before resolved critical test..."
sleep 3
echo ""

echo "✅ Test 2: Critical resolved notification..."
RESPONSE=$(post_alert "$CRITICAL_RESOLVED_PAYLOAD")
echo "Response: $RESPONSE"
assert_response_field "$RESPONSE" "deliveryTier" "critical" "Delivery tier"
assert_subject_contains "$RESPONSE" "\[RESOLVED\]" "Resolved prefix"
assert_subject_contains "$RESPONSE" "\[CRITICAL\]" "Critical subject prefix"
echo ""

echo "📬 Test 3: Digest batch (high + medium alerts)..."
RESPONSE=$(post_alert "$DIGEST_FIRING_PAYLOAD")
echo "Response: $RESPONSE"
assert_response_field "$RESPONSE" "deliveryTier" "digest" "Delivery tier"
assert_subject_contains "$RESPONSE" "\[Digest\]" "Digest subject prefix"
assert_subject_contains "$RESPONSE" "3 alerts" "Grouped alert count"
assert_subject_contains "$RESPONSE" "${DIGEST_GROUP_NAME}" "Digest group name in subject"
echo ""

echo "========================================="
echo "✅ All tests passed!"
echo ""
echo "Check your email inbox for the test alerts."
echo "You can also check CloudWatch Logs for the Lambda function:"
echo "  aws logs tail /aws/lambda/archaser-alert-webhook-production --follow"
echo "========================================="
