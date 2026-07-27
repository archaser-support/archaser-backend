# AWS SNS Alert Integration for Grafana

This directory contains the infrastructure setup for integrating AWS SNS with Grafana alerts, featuring **custom HTML email templates**.

## Architecture

```
Grafana Alert → Webhook → API Gateway → Lambda
                                          ↓
                              ┌───────────┴───────────┐
                              │                       │
                           SES Email              SNS Topic
                         (HTML Template)              ↓
                                            ┌────────┴────────┐
                                            │                 │
                                         Slack           Other Subscribers
                                    (AWS Chatbot)        (SMS, Lambda, etc.)
```

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

### SNS messages not reaching Slack

1. Verify AWS Chatbot is configured correctly
2. Check SNS subscription is confirmed
3. Ensure the Slack channel allows AWS Chatbot app

---

## Files

| File | Description |
|------|-------------|
| `cloudformation-sns.yaml` | Main infrastructure template with HTML email support |
| `deploy.sh` | Deployment script |
| `test-alerts.sh` | Test script for verifying integration |
| `SLACK_INTEGRATION.md` | Slack setup guide |
| `README.md` | This file |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GRAFANA_SNS_WEBHOOK_URL` | Webhook URL for Grafana | (required) |
| `ALERT_EMAIL` | Email recipient | nilotpal@archaser.com |
| `SES_FROM_ADDRESS` | SES verified sender | alerts@archaser.com |
