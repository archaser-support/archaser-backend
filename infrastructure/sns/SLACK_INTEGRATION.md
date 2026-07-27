# Slack Integration Guide for ARChaser Alerts

This guide explains how to add Slack notifications to your ARChaser alert system using AWS Chatbot.

## Prerequisites

1. AWS SNS infrastructure deployed (see `cloudformation-sns.yaml`)
2. Admin access to your Slack workspace
3. AWS Console access

## Setup Steps

### Step 1: Configure AWS Chatbot for Slack

1. **Open AWS Chatbot Console**
   - Go to: https://console.aws.amazon.com/chatbot

2. **Configure Slack Workspace**
   - Click "Configure new client"
   - Select "Slack"
   - Click "Configure"
   - You'll be redirected to Slack for authorization
   - Authorize AWS Chatbot to access your workspace

### Step 2: Create a Channel Configuration

1. In AWS Chatbot, click "Configure new channel"

2. **Configuration details:**
   - Configuration name: `archaser-alerts`
   - Slack channel: Select your alerts channel (e.g., `#alerts` or `#ops`)
   - Permissions: 
     - IAM role: Create a new role or use existing
     - Role name: `AWSChatbotRole-archaser-alerts`
   
3. **Choose the SNS topic:**
   - Select Region: `eu-north-1`
   - Select Topics: `archaser-system-alerts-production`

4. Click "Configure"

### Step 3: Test the Integration

You can test by publishing a test message to SNS:

```bash
aws sns publish \
  --topic-arn arn:aws:sns:eu-north-1:YOUR_ACCOUNT_ID:archaser-system-alerts-production \
  --subject "Test Alert from ARChaser" \
  --message "This is a test message to verify Slack integration is working correctly." \
  --region eu-north-1
```

## Message Formatting

AWS Chatbot automatically formats SNS messages for Slack. The Lambda function in our setup creates structured messages that display well in Slack:

- 🚨 for firing alerts
- ✅ for resolved alerts
- Alert details including severity, summary, and dashboard links

## Advanced: Custom Slack Formatting with Lambda

For more control over Slack message formatting, you can modify the Lambda function to use Slack Block Kit:

```javascript
// Example: Enhanced Slack-formatted message
const slackBlocks = [
  {
    type: "header",
    text: {
      type: "plain_text",
      text: `${statusEmoji} ${alertName}`,
      emoji: true
    }
  },
  {
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Status:*\n${alertStatus}` },
      { type: "mrkdwn", text: `*Severity:*\n${severity}` }
    ]
  }
];
```

## Troubleshooting

### Messages not appearing in Slack

1. Check AWS Chatbot configuration is active
2. Verify SNS topic subscription is confirmed
3. Check CloudWatch logs for the Lambda function

### Permission errors

Ensure the AWS Chatbot IAM role has these permissions:
- `chatbot:*`
- `sns:Subscribe`
- `sns:ListSubscriptionsByTopic`

## Multiple Channels

You can create multiple channel configurations to route different alerts to different Slack channels:

- `#alerts-critical` - Critical severity alerts only
- `#alerts-all` - All alerts
- `#alerts-staging` - Staging environment alerts

Use SNS message filtering to route based on attributes:

```json
{
  "alertStatus": ["firing"],
  "severity": ["critical", "high"]
}
```
