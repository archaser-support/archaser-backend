# AWS SNS Alert Integration for Grafana

This directory contains the infrastructure setup for integrating AWS SNS with Grafana alerts, featuring **custom HTML email templates**.

## Architecture

```
Grafana Alert → Webhook → API Gateway → Lambda
                                          ↓
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                 SES Email            SNS Topic           ClickUp Chat
               (HTML Template)            ↓                (ARchaser)
                                    Slack / others
```

ClickUp Chat is additive. Email and Slack stay on. Empty `CLICKUP_CHAT_TOKEN` or `CLICKUP_CHAT_CHANNEL_ID` skips Chat (`clickupStatus: skipped_unconfigured`).

## Features

- ✅ **HTML Email Templates** - Beautiful, responsive alert emails via SES
- ✅ **SNS Fan-out** - Easy integration with Slack, SMS, and other channels
- ✅ **Custom Formatting** - Full control over email design
- ✅ **Plain Text Fallback** - For email clients that don't support HTML

---

## Quick Start

### 1. Prerequisites

- AWS CLI configured with appropriate permissions
- SES email address verified (alerts@archaser.com)
- AWS region: `eu-north-1`

### 2. Deploy the Stack

```bash
cd infrastructure/sns
chmod +x deploy.sh
./deploy.sh
```

### 3. Get the Webhook URL

```bash
aws cloudformation describe-stacks \
  --stack-name archaser-alert-sns \
  --query "Stacks[0].Outputs[?OutputKey=='WebhookUrl'].OutputValue" \
  --output text \
  --region eu-north-1
```

### 4. Configure Grafana

Add the webhook URL to your environment:

```bash
# On your EC2 server
echo "GRAFANA_SNS_WEBHOOK_URL=https://xxxxx.execute-api.eu-north-1.amazonaws.com/v1/alert" >> .env

# Restart Grafana
docker-compose -f docker-compose.logging.yml up -d grafana
```

---

## Testing

### Test Script

Run the included test script to verify the integration:

```bash
chmod +x test-alerts.sh
./test-alerts.sh
```

This sends sample "firing" and "resolved" alerts to verify:
- Webhook is accessible
- Lambda processes the alert correctly
- HTML email is sent via SES
- Message is published to SNS
- Response includes `clickupStatus` (`skipped_unconfigured` until ClickUp params are set)

After ClickUp token and ARchaser channel id are set on the stack:

```bash
CLICKUP_EXPECT=posted ./test-alerts.sh
```

### Manual Testing with cURL

**Test a FIRING alert:**
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "firing",
    "alerts": [{
      "status": "firing",
      "labels": {
        "alertname": "TestAlert",
        "severity": "critical"
      },
      "annotations": {
        "summary": "Test alert from manual cURL",
        "description": "This is a test to verify the integration works"
      },
      "generatorURL": "https://grafana.archaser.com"
    }],
    "groupLabels": { "alertname": "TestAlert" }
  }'
```

**Test a RESOLVED alert:**
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "resolved",
    "alerts": [{
      "status": "resolved",
      "labels": {
        "alertname": "TestAlert",
        "severity": "critical"
      },
      "annotations": {
        "summary": "Test alert resolved",
        "description": "The test alert has been resolved"
      }
    }],
    "groupLabels": { "alertname": "TestAlert" }
  }'
```

### Test Directly via SNS

```bash
aws sns publish \
  --topic-arn arn:aws:sns:eu-north-1:YOUR_ACCOUNT:archaser-system-alerts-production \
  --subject "Test Alert" \
  --message "This is a test message from SNS" \
  --region eu-north-1
```

### Check Lambda Logs

```bash
aws logs tail /aws/lambda/archaser-alert-webhook-production --follow --region eu-north-1
```

---

## Customizing the HTML Email Template

The email template is defined in the Lambda function within `cloudformation-sns.yaml`. 

### Template Location

Look for the `generateHtmlEmail` function in the CloudFormation template (around line 98):

```javascript
const generateHtmlEmail = (alertStatus, alertName, alerts) => {
  // Template code here
};
```

### Key Customization Points

#### 1. **Colors**

```javascript
// Status colors
const statusColor = alertStatus === 'firing' ? '#dc3545' : '#28a745';

// Severity colors
const severityColors = {
  critical: { bg: '#fef2f2', border: '#dc3545', text: '#991b1b' },
  high:     { bg: '#fff7ed', border: '#fd7e14', text: '#9a3412' },
  medium:   { bg: '#fefce8', border: '#ffc107', text: '#854d0e' },
  low:      { bg: '#f8f9fa', border: '#6c757d', text: '#495057' }
};
```

#### 2. **Header Section**

```html
<!-- Header with gradient background -->
<div style="background: linear-gradient(135deg, ${statusColor} 0%, ... 100%);">
  <div style="font-size: 48px;">${statusEmoji}</div>
  <h1>System Health Alert</h1>
</div>
```

#### 3. **Alert Details Table**

Add or remove fields in the alert details section:

```html
<tr>
  <td style="color: #6b7280;">Your Label:</td>
  <td>${alert.labels?.yourCustomLabel || 'N/A'}</td>
</tr>
```

#### 4. **Footer**

```html
<div style="border-top: 1px solid #e5e7eb; text-align: center;">
  <p>Generated by ARChaser System Monitor</p>
  <img src="https://your-logo-url.com/logo.png" alt="Logo" />
</div>
```

### Deploying Template Changes

After modifying the template, update the stack:

```bash
aws cloudformation update-stack \
  --stack-name archaser-alert-sns \
  --template-body file://cloudformation-sns.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region eu-north-1

# Wait for update to complete
aws cloudformation wait stack-update-complete \
  --stack-name archaser-alert-sns \
  --region eu-north-1
```

---

## Adding Email Recipients

### Add via CloudFormation Parameter

Update the stack with a new email:

```bash
aws cloudformation update-stack \
  --stack-name archaser-alert-sns \
  --template-body file://cloudformation-sns.yaml \
  --parameters \
    ParameterKey=AlertEmailAddress,ParameterValue=newemail@archaser.com \
  --capabilities CAPABILITY_NAMED_IAM \
  --region eu-north-1
```

### Add Multiple Recipients

Modify the Lambda's `ALERT_EMAIL` to support multiple recipients:

```javascript
// In the Lambda code
Destination: {
  ToAddresses: process.env.ALERT_EMAIL.split(',').map(e => e.trim())
}
```

Then set the environment variable:
```
ALERT_EMAIL=nilotpal@archaser.com,team@archaser.com
```

---

## Slack Integration

See [SLACK_INTEGRATION.md](./SLACK_INTEGRATION.md) for detailed Slack setup instructions using AWS Chatbot.

---

## Troubleshooting

### Email not received

1. **Check SES verification**: Ensure `alerts@archaser.com` is verified in SES
2. **Check SES sandbox**: If in sandbox mode, recipient must also be verified
3. **Check Lambda logs**: `aws logs tail /aws/lambda/archaser-alert-webhook-production`

### Webhook returns 500 error

1. Check Lambda execution role has SES permissions
2. Verify the JSON payload format matches Grafana's alert format
3. Check CloudWatch logs for detailed error messages

### ClickUp Chat not appearing

1. Confirm `CLICKUP_CHAT_TOKEN` and `CLICKUP_CHAT_CHANNEL_ID` are set on the Lambda (ARchaser channel, not Customers)
2. Check the webhook JSON for `clickupStatus` (`skipped_unconfigured`, `skipped_resolved_digest`, `posted`, or `failed`)
3. `failed` still returns HTTP 200 so Grafana does not retry and duplicate email — see CloudWatch for `clickupError` (the token is never logged)

### SNS messages not reaching Slack

1. Verify AWS Chatbot is configured correctly
2. Check SNS subscription is confirmed
3. Ensure the Slack channel allows AWS Chatbot app

---

## Files

| File | Description |
|------|-------------|
| `cloudformation-sns.yaml` | Main infrastructure template with HTML email support |
| `clickup-chat-intent.js` | Pure Chat skip/post classifier and markdown body (no HTTP) |
| `deploy.sh` | Deployment script |
| `test-alerts.sh` | Test script for verifying integration |
| `SLACK_INTEGRATION.md` | Slack setup guide |
| `README.md` | This file |

---

## ClickUp Chat (ARchaser)

Production Grafana alerts post as ordinary Chat **messages** (markdown, not tasks, not Posts) in the existing **ARchaser** channel. No @mentions and no assignees. Staging Grafana stays on the silent contact point and must not hit this webhook.

### CloudFormation / Lambda keys

Set these on the stack (do not put tokens in git). Agents do not read local dotenv files.

| Parameter / env | Description |
|-----------------|-------------|
| `ClickUpChatToken` / `CLICKUP_CHAT_TOKEN` | NoEcho Chat write token. Empty skips Chat. |
| `ClickUpChatChannelId` / `CLICKUP_CHAT_CHANNEL_ID` | ARchaser channel id (not Customers). Empty skips Chat. |
| `ClickUpChatWorkspaceId` / `CLICKUP_CHAT_WORKSPACE_ID` | Optional workspace id. If empty, the Lambda uses the ARchaser workspace `25708732`. |
| `ClickUpChatEnabled` / `CLICKUP_CHAT_ENABLED` | Optional toggle. Empty means on when token and channel are both set. |

Example stack update (paste the token yourself; do not commit it):

```bash
aws cloudformation update-stack \
  --stack-name archaser-alert-sns \
  --template-body file://cloudformation-sns.yaml \
  --parameters \
    ParameterKey=Environment,UsePreviousValue=true \
    ParameterKey=AlertEmailAddress,UsePreviousValue=true \
    ParameterKey=ClickUpChatToken,ParameterValue='YOUR_TOKEN' \
    ParameterKey=ClickUpChatChannelId,ParameterValue='YOUR_ARCHASER_CHANNEL_ID' \
  --capabilities CAPABILITY_NAMED_IAM \
  --region eu-north-1
```

`deploy.sh` also forwards `CLICKUP_CHAT_TOKEN`, `CLICKUP_CHAT_CHANNEL_ID`, and `CLICKUP_CHAT_WORKSPACE_ID` when those variables are already set in the shell.

### How to test

1. Update the production alert stack with token and ARchaser channel id. Recreate/update the Lambda.
2. `CLICKUP_EXPECT=posted ./test-alerts.sh` — critical firing: email + Slack as today **and** one markdown Chat line in ARchaser. No @mention.
3. Critical resolved: cleared Chat message (`✅` / `[RESOLVED]`) plus resolved email. Firing cooldown does not block this.
4. Digest firing (three high/medium alerts): **one** ARchaser digest message listing all three, plus digest email.
5. Digest resolved: **no** new ARchaser message (`clickupStatus: skipped_resolved_digest`); email may still send.
6. Confirm staging Grafana still does not page; nothing new in ARchaser from staging.
7. With token unset (or a bad token): critical firing still emails; Chat is `skipped_unconfigured` or `failed`; webhook 200.

ClickUp HTTP failures are logged (never the token) as `clickupStatus: failed` and optional `clickupError`. Email and SNS still succeed.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GRAFANA_SNS_WEBHOOK_URL` | Webhook URL for Grafana | (required) |
| `ALERT_EMAIL` | Email recipient | nilotpal@archaser.com |
| `SES_FROM_ADDRESS` | SES verified sender | alerts@archaser.com |
| `CLICKUP_CHAT_TOKEN` | ClickUp Chat token (NoEcho). Empty skips Chat. | (empty) |
| `CLICKUP_CHAT_CHANNEL_ID` | ARchaser Chat channel id. Empty skips Chat. | (empty) |
| `CLICKUP_CHAT_WORKSPACE_ID` | Optional ClickUp workspace id | (empty; Lambda falls back to `25708732`) |
| `CLICKUP_CHAT_ENABLED` | Optional Chat toggle; empty means on when token and channel are set | (empty) |
| `CLICKUP_EXPECT` | `test-alerts.sh` expected `clickupStatus` for post intents | `skipped_unconfigured` |
