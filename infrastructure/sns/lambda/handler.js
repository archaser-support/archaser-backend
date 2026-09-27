'use strict';

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { buildClickUpChatIntent } = require('./clickupChat');
const { fetchDetailsByAlertIndex } = require('./fetchAlertDetails');
const {
  classifyDeliveryTier,
  buildSubject,
  generateHtmlEmail,
  generatePlainText,
  postClickUpChatMessage,
} = require('./emailTemplates');

const snsClient = new SNSClient({});
const sesClient = new SESClient({ region: process.env.AWS_SES_REGION || 'eu-north-1' });
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

async function handler(event) {
  console.log('Received Grafana webhook:', JSON.stringify(event));
  
  try {
    // Parse the incoming Grafana alert
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    
    // Extract alert details
    const alertStatus = body.status || 'unknown';
    const alerts = body.alerts || [];
    const groupLabels = body.groupLabels || {};
    const commonLabels = body.commonLabels || {};
    const alertName = groupLabels.alertname || commonLabels.alertname || 'System Alert';

    // Cooldown Check
    if (alertStatus === 'firing') {
      try {
        const getCmd = new GetCommand({
          TableName: process.env.COOLDOWN_TABLE_NAME,
          Key: { AlertName: alertName }
        });
        const data = await docClient.send(getCmd);
        if (data.Item && data.Item.LastSentAt) {
          const lastSent = new Date(data.Item.LastSentAt);
          const now = new Date();
          const hoursDiff = (now - lastSent) / (1000 * 60 * 60);
          if (hoursDiff < 24) {
            console.log(`Skipping alert ${alertName} due to cooldown. Last sent: ${lastSent.toISOString()}, Hours diff: ${hoursDiff.toFixed(2)}`);
            return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                success: true,
                message: 'Alert suppressed due to cooldown',
                clickupStatus: 'skipped_cooldown'
              })
            };
          }
        }
      } catch (err) {
        console.error('Error checking cooldown:', err);
      }
    }
    
    // Fetch detailed information once per resolved alert type
    let detailsByAlertIndex = [];
    let anyDetailsFetched = false;
    if (alertStatus === 'firing') {
      detailsByAlertIndex = await fetchDetailsByAlertIndex(alerts, alertName);
      anyDetailsFetched = detailsByAlertIndex.some(
        (d) => d && ((d.details && d.details.length > 0) || d.runbook)
      );
      if (anyDetailsFetched) {
        console.log(`Fetched alert details for ${detailsByAlertIndex.filter(Boolean).length}/${alerts.length} alerts`);
      }
    }
    
    const deliveryTier = classifyDeliveryTier(alerts, commonLabels);
    const chatIntent = buildClickUpChatIntent({
      alerts,
      commonLabels,
      alertStatus,
      alertName,
      environment: process.env.ENVIRONMENT,
      token: process.env.CLICKUP_CHAT_TOKEN,
      channelId: process.env.CLICKUP_CHAT_CHANNEL_ID,
      enabled: process.env.CLICKUP_CHAT_ENABLED,
    });
    console.log('ClickUp Chat intent:', {
      intent: chatIntent.intent,
      clickupStatus: chatIntent.clickupStatus,
      chatDeliveryTier: chatIntent.chatDeliveryTier,
    });

    // Generate messages
    const htmlBody = generateHtmlEmail(alertStatus, alertName, alerts, detailsByAlertIndex, deliveryTier);
    const textBody = generatePlainText(alertStatus, alertName, alerts, detailsByAlertIndex, deliveryTier);
    const envName = process.env.ENVIRONMENT ? process.env.ENVIRONMENT.charAt(0).toUpperCase() + process.env.ENVIRONMENT.slice(1) : 'Production';
    const subject = buildSubject(envName, alertStatus, deliveryTier, alertName, alerts.length);
    
    // Send HTML email via SES
    const sesCommand = new SendEmailCommand({
      Source: process.env.SES_FROM_ADDRESS,
      Destination: {
        ToAddresses: process.env.ALERT_EMAIL.split(',').map(e => e.trim())
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8'
        },
        Body: {
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8'
          },
          Text: {
            Data: textBody,
            Charset: 'UTF-8'
          }
        }
      }
    });
    
    await sesClient.send(sesCommand);
    console.log('Successfully sent HTML email via SES');
    
    // Also publish to SNS for Slack and other subscribers
    const snsCommand = new PublishCommand({
      TopicArn: process.env.SNS_TOPIC_ARN,
      Subject: subject,
      Message: textBody,
      MessageAttributes: {
        'alertStatus': { DataType: 'String', StringValue: alertStatus },
        'alertName': { DataType: 'String', StringValue: alertName },
        'deliveryTier': { DataType: 'String', StringValue: deliveryTier },
        'source': { DataType: 'String', StringValue: 'grafana' }
      }
    });
    
    await snsClient.send(snsCommand);
    console.log('Successfully published to SNS');

    let clickupStatus = chatIntent.clickupStatus;
    let clickupError;
    if (chatIntent.intent === 'post' && clickupStatus === 'posted') {
      try {
        const workspaceId = String(process.env.CLICKUP_CHAT_WORKSPACE_ID || '').trim() || '25708732';
        await postClickUpChatMessage({
          token: process.env.CLICKUP_CHAT_TOKEN,
          workspaceId,
          channelId: process.env.CLICKUP_CHAT_CHANNEL_ID,
          markdown: chatIntent.markdown,
        });
        console.log('Successfully posted ClickUp Chat message');
      } catch (err) {
        clickupStatus = 'failed';
        clickupError = err.message || 'ClickUp Chat post failed';
        console.error('ClickUp Chat post failed:', clickupError);
      }
    }

    // Update Cooldown Timestamp
    if (alertStatus === 'firing') {
      try {
        const putCmd = new PutCommand({
          TableName: process.env.COOLDOWN_TABLE_NAME,
          Item: {
            AlertName: alertName,
            LastSentAt: new Date().toISOString()
          }
        });
        await docClient.send(putCmd);
        console.log(`Updated cooldown timestamp for ${alertName}`);
      } catch (err) {
        console.error('Error updating cooldown timestamp:', err);
      }
    }
    
    const responseBody = { 
        success: true, 
        message: 'Alert sent via SES and published to SNS',
        detailsFetched: anyDetailsFetched,
        deliveryTier,
        subject,
        clickupStatus
      };
    if (clickupError) {
      responseBody.clickupError = clickupError;
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responseBody)
    };
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
};


module.exports = { handler };
