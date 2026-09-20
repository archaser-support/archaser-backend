#!/bin/bash
# ARChaser SNS Alert Infrastructure Deployment Script
# This script deploys the CloudFormation stack and outputs the webhook URL

set -e

# Configuration
STACK_NAME="archaser-alert-sns"
REGION="${AWS_REGION:-eu-north-1}"
ENVIRONMENT="${ENVIRONMENT:-production}"
ALERT_EMAIL="${ALERT_EMAIL:-nilotpal@archaser.com}"
CLICKUP_CHAT_PARAMS=()
if [ -n "${CLICKUP_CHAT_TOKEN:-}" ]; then
    CLICKUP_CHAT_PARAMS+=("ParameterKey=ClickUpChatToken,ParameterValue=${CLICKUP_CHAT_TOKEN}")
fi
if [ -n "${CLICKUP_CHAT_CHANNEL_ID:-}" ]; then
    CLICKUP_CHAT_PARAMS+=("ParameterKey=ClickUpChatChannelId,ParameterValue=${CLICKUP_CHAT_CHANNEL_ID}")
fi
if [ -n "${CLICKUP_CHAT_WORKSPACE_ID:-}" ]; then
    CLICKUP_CHAT_PARAMS+=("ParameterKey=ClickUpChatWorkspaceId,ParameterValue=${CLICKUP_CHAT_WORKSPACE_ID}")
fi
if [ -n "${CLICKUP_CHAT_ENABLED:-}" ]; then
    CLICKUP_CHAT_PARAMS+=("ParameterKey=ClickUpChatEnabled,ParameterValue=${CLICKUP_CHAT_ENABLED}")
fi

echo "========================================="
echo "ARChaser SNS Alert Infrastructure Setup"
echo "========================================="
echo ""
echo "Configuration:"
echo "  Stack Name:  $STACK_NAME"
echo "  Region:      $REGION"
echo "  Environment: $ENVIRONMENT"
echo "  Alert Email: $ALERT_EMAIL"
if [ -n "${CLICKUP_CHAT_TOKEN:-}" ] && [ -n "${CLICKUP_CHAT_CHANNEL_ID:-}" ]; then
    echo "  ClickUp Chat: configured (token not printed)"
else
    echo "  ClickUp Chat: skipped until token and channel id are set"
fi
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ Error: AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if the stack already exists
STACK_EXISTS=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION 2>/dev/null || echo "false")

if [ "$STACK_EXISTS" != "false" ]; then
    echo "📦 Stack already exists. Updating..."
    aws cloudformation update-stack \
        --stack-name $STACK_NAME \
        --template-body file://cloudformation-sns.yaml \
        --parameters \
            ParameterKey=Environment,ParameterValue=$ENVIRONMENT \
            ParameterKey=AlertEmailAddress,ParameterValue=$ALERT_EMAIL \
            ${CLICKUP_CHAT_PARAMS[@]+"${CLICKUP_CHAT_PARAMS[@]}"} \
        --capabilities CAPABILITY_NAMED_IAM \
        --region $REGION || true
    
    echo "⏳ Waiting for stack update to complete..."
    aws cloudformation wait stack-update-complete --stack-name $STACK_NAME --region $REGION 2>/dev/null || true
else
    echo "📦 Creating new stack..."
    aws cloudformation create-stack \
        --stack-name $STACK_NAME \
        --template-body file://cloudformation-sns.yaml \
        --parameters \
            ParameterKey=Environment,ParameterValue=$ENVIRONMENT \
            ParameterKey=AlertEmailAddress,ParameterValue=$ALERT_EMAIL \
            ${CLICKUP_CHAT_PARAMS[@]+"${CLICKUP_CHAT_PARAMS[@]}"} \
        --capabilities CAPABILITY_NAMED_IAM \
        --region $REGION
    
    echo "⏳ Waiting for stack creation to complete..."
    aws cloudformation wait stack-create-complete --stack-name $STACK_NAME --region $REGION
fi

echo ""
echo "✅ Stack deployment complete!"
echo ""

# Get outputs
echo "📋 Stack Outputs:"
echo "----------------------------------------"

WEBHOOK_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='WebhookUrl'].OutputValue" \
    --output text \
    --region $REGION)

SNS_TOPIC_ARN=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='SNSTopicArn'].OutputValue" \
    --output text \
    --region $REGION)

echo ""
echo "🔗 Webhook URL (for Grafana):"
echo "   $WEBHOOK_URL"
echo ""
echo "📢 SNS Topic ARN:"
echo "   $SNS_TOPIC_ARN"
echo ""
echo "========================================="
echo "Next Steps:"
echo "========================================="
echo ""
echo "1. Confirm the email subscription sent to: $ALERT_EMAIL"
echo ""
echo "2. Set the webhook URL in your environment:"
echo "   export GRAFANA_SNS_WEBHOOK_URL=\"$WEBHOOK_URL\""
echo ""
echo "3. Add to your .env file on the server:"
echo "   GRAFANA_SNS_WEBHOOK_URL=$WEBHOOK_URL"
echo ""
echo "4. Restart Grafana to apply the new configuration:"
echo "   docker-compose -f backend/grafana/docker-compose.logging.yml up -d grafana"
echo ""
echo "5. (Optional) Set up Slack integration:"
echo "   See SLACK_INTEGRATION.md for detailed instructions"
echo ""
