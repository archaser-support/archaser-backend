'use strict';

const https = require('https');
const {
  buildGrafanaDrilldownUrl,
  rewriteGrafanaUrls,
} = require('./grafanaLinks');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAnnotationHtml(text, environment) {
  return escapeHtml(rewriteGrafanaUrls(text, environment)).replace(/\n/g, '<br>');
}

function generateDetailsHtml(details) {
  if (!details || !details.details || details.details.length === 0) {
    const runbookOnly = details?.runbook
      ? `<div style="margin-top: 12px; padding: 12px; background-color: #fff7ed; border-radius: 6px; border: 1px solid #fed7aa; color: #9a3412; font-size: 12px;"><strong>How to fix:</strong> ${escapeHtml(details.runbook)}</div>`
      : '';
    return runbookOnly;
  }
  
  const rows = details.details.map(item => {
    const cells = Object.entries(item)
      .filter(([key]) => key !== 'period_id' && key !== 'activity_id')
      .map(([key, value]) => {
        const displayValue = value === null || value === undefined ? 'N/A' : value;
        return `<td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 12px;">${escapeHtml(displayValue)}</td>`;
      }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  
  const headers = Object.keys(details.details[0])
    .filter(key => key !== 'period_id' && key !== 'activity_id')
    .map(key => {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `<th style="padding: 8px; border-bottom: 2px solid #374151; text-align: left; font-size: 12px; color: #374151;">${escapeHtml(label)}</th>`;
    }).join('');

  const runbookHtml = details.runbook
    ? `<div style="margin-top: 12px; padding: 12px; background-color: #fff7ed; border-radius: 6px; border: 1px solid #fed7aa; color: #9a3412; font-size: 12px;"><strong>How to fix:</strong> ${escapeHtml(details.runbook)}</div>`
    : '';
  
  return `
    <div style="margin-top: 20px; padding: 15px; background-color: #f9fafb; border-radius: 8px;">
      <h4 style="margin: 0 0 10px 0; color: #374151; font-size: 14px;">📋 Affected Records (${escapeHtml(details.count)} total, showing top ${details.details.length})</h4>
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background-color: #e5e7eb;">${headers}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${runbookHtml}
    </div>
  `;
}

function classifyDeliveryTier(alerts, commonLabels) {
  if (commonLabels?.delivery === 'digest') {
    return 'digest';
  }
  const severities = alerts.map(a => (a.labels?.severity || '').toLowerCase());
  if (severities.some(s => s === 'critical')) {
    return 'critical';
  }
  return 'digest';
}

function buildSubject(envName, alertStatus, deliveryTier, alertName, alertCount) {
  const statusPrefix = alertStatus === 'resolved' ? '[RESOLVED] ' : '';
  const tierPrefix = deliveryTier === 'critical' ? '[CRITICAL] ' : '[Digest] ';
  return `[${envName}] ${statusPrefix}${tierPrefix}${alertName} (${alertCount} alert${alertCount !== 1 ? 's' : ''})`;
}

function generateDigestSummaryHtml(alerts) {
  if (alerts.length <= 1) {
    return '';
  }
  const items = alerts.map((alert, index) => {
    const severity = (alert.labels?.severity || 'unknown').toUpperCase();
    const summary = alert.annotations?.summary || alert.labels?.alertname || `Alert ${index + 1}`;
    const status = (alert.status || 'unknown').toUpperCase();
    return `<li style="margin-bottom: 6px;"><strong>${summary}</strong> — ${severity} — ${status}</li>`;
  }).join('');
  return `
    <div style="margin-bottom: 24px; padding: 16px; background-color: #eff6ff; border-radius: 8px; border: 1px solid #bfdbfe;">
      <h4 style="margin: 0 0 12px 0; color: #1e40af; font-size: 14px;">📬 Digest summary — ${alerts.length} alerts in this batch</h4>
      <ul style="margin: 0; padding-left: 20px; color: #1f2937; font-size: 13px;">${items}</ul>
    </div>
  `;
}

function generateDigestSummaryText(alerts) {
  if (alerts.length <= 1) {
    return '';
  }
  let text = `Digest summary (${alerts.length} alerts):\n`;
  alerts.forEach((alert, index) => {
    const severity = alert.labels?.severity || 'unknown';
    const summary = alert.annotations?.summary || alert.labels?.alertname || `Alert ${index + 1}`;
    text += `  ${index + 1}. ${summary} [${severity}] (${alert.status})\n`;
  });
  text += '\n';
  return text;
}

const generateHtmlEmail = (alertStatus, alertName, alerts, detailsByAlertIndex, deliveryTier) => {
  const statusColor = alertStatus === 'firing' ? '#dc3545' : '#28a745';
  const statusEmoji = alertStatus === 'firing' ? '🚨' : '✅';
  const headerTitle = deliveryTier === 'critical' ? 'Critical Alert' : 'Alert Digest';
  const digestSummaryHtml = deliveryTier === 'digest' ? generateDigestSummaryHtml(alerts) : '';
  
  const alertsHtml = alerts.map((alert, index) => {
    const severity = alert.labels?.severity || 'low';
    const severityColors = {
      critical: { bg: '#fef2f2', border: '#dc3545', text: '#991b1b' },
      high: { bg: '#fff7ed', border: '#fd7e14', text: '#9a3412' },
      medium: { bg: '#fefce8', border: '#ffc107', text: '#854d0e' },
      low: { bg: '#f8f9fa', border: '#6c757d', text: '#495057' }
    };
    const colors = severityColors[severity] || severityColors.low;
    
    // Include details table if available for this alert
    const alertDetails = detailsByAlertIndex?.[index] || null;
    const detailsHtml = alertDetails ? generateDetailsHtml(alertDetails) : '';
    
    // Construct dashboard URL based on environment + alert type
    const dashboardUrl = buildGrafanaDrilldownUrl(process.env.ENVIRONMENT, alert);
    const metricValue =
      alert.valueString ||
      alert.annotations?.value ||
      (alert.values ? JSON.stringify(alert.values) : null);
    
    return `
      <div style="margin-bottom: 20px; background-color: ${colors.bg}; padding: 20px; border-radius: 8px; border-left: 4px solid ${colors.border};">
        <h3 style="margin: 0 0 15px 0; color: #1f2937; font-size: 16px;">
          ${escapeHtml(alert.annotations?.summary || 'Alert Details')}
        </h3>
        
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; width: 120px;">Status:</td>
            <td style="padding: 8px 0; font-weight: bold; color: ${statusColor};">${escapeHtml(alert.status?.toUpperCase())}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Severity:</td>
            <td style="padding: 8px 0;">
              <span style="background-color: ${colors.border}; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold;">
                ${escapeHtml(severity.toUpperCase())}
              </span>
            </td>
          </tr>
          ${alert.annotations?.description ? `
          <tr>
            <td style="padding: 8px 0; color: #6b7280; vertical-align: top;">Description:</td>
            <td style="padding: 8px 0; color: #374151;">${formatAnnotationHtml(alert.annotations.description, process.env.ENVIRONMENT)}</td>
          </tr>
          ` : ''}
          ${metricValue ? `
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Metric:</td>
            <td style="padding: 8px 0; color: #374151; font-family: monospace; font-size: 12px;">${escapeHtml(metricValue)}</td>
          </tr>
          ` : ''}
          ${alert.labels?.instance ? `
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Instance:</td>
            <td style="padding: 8px 0; color: #374151; font-family: monospace;">${escapeHtml(alert.labels.instance)}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Dashboard:</td>
            <td style="padding: 8px 0;">
              <a href="${dashboardUrl}" style="color: #2563eb; text-decoration: none;">View in Grafana →</a>
            </td>
          </tr>
        </table>
        
        ${detailsHtml}
      </div>
    `;
  }).join('');
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
      <div style="max-width: 700px; margin: 0 auto; padding: 20px;">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, ${statusColor} 0%, ${alertStatus === 'firing' ? '#b91c1c' : '#16a34a'} 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 10px;">${statusEmoji}</div>
          <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 600;">
            ${headerTitle}
          </h1>
          <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">
            ${alertStatus.toUpperCase()} - ${escapeHtml(alertName)}
          </p>
          <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.7); font-size: 14px;">
            ${alerts.length} alert${alerts.length !== 1 ? 's' : ''} in this notification
          </p>
        </div>
        
        <!-- Content -->
        <div style="background-color: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          ${digestSummaryHtml}
          ${alertsHtml}
          
          <!-- Footer -->
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="margin: 0; color: #9ca3af; font-size: 12px;">
              Generated by ARChaser System Monitor
            </p>
            <p style="margin: 5px 0 0 0; color: #9ca3af; font-size: 12px;">
              ${new Date().toISOString()}
            </p>
          </div>
        </div>
        
      </div>
    </body>
    </html>
  `;
};

const generatePlainText = (alertStatus, alertName, alerts, detailsByAlertIndex, deliveryTier) => {
  const statusEmoji = alertStatus === 'firing' ? '🚨' : '✅';
  const tierLabel = deliveryTier === 'critical' ? 'CRITICAL' : 'DIGEST';
  let text = `${statusEmoji} [${tierLabel}] ${alertName} - ${alertStatus.toUpperCase()}\n\n`;
  text += generateDigestSummaryText(alerts);
  
  alerts.forEach((alert, index) => {
    const severity = alert.labels?.severity || 'unknown';
    const summary = alert.annotations?.summary || 'No summary provided';
    const description = rewriteGrafanaUrls(
      alert.annotations?.description || '',
      process.env.ENVIRONMENT
    );
    const alertDetails = detailsByAlertIndex?.[index] || null;
    const alertDashboardUrl = buildGrafanaDrilldownUrl(
      process.env.ENVIRONMENT,
      alert
    );
    
    text += `Alert ${index + 1}:\n`;
    text += `  Status: ${alert.status}\n`;
    text += `  Severity: ${severity}\n`;
    text += `  Summary: ${summary}\n`;
    if (description) text += `  Description: ${description}\n`;
    text += `  Dashboard: ${alertDashboardUrl}\n`;

    if (alertDetails && alertDetails.details && alertDetails.details.length > 0) {
      text += `\n  Affected Records (${alertDetails.count} total, showing top ${alertDetails.details.length}):\n`;
      alertDetails.details.forEach((item, i) => {
        text += `    ${i + 1}. `;
        Object.entries(item).forEach(([key, value]) => {
          if (key !== 'period_id' && key !== 'activity_id') {
            text += `${key}=${value ?? 'N/A'}; `;
          }
        });
        text += '\n';
      });
      if (alertDetails.runbook) {
        text += `  How to fix: ${alertDetails.runbook}\n`;
      }
    }
    text += '\n';
  });
  
  text += `\n---\nGenerated by ARChaser System Monitor`;
  return text;
};

function postClickUpChatMessage({ token, workspaceId, channelId, markdown }) {
  const workspace = encodeURIComponent(String(workspaceId || '').trim());
  const channel = encodeURIComponent(String(channelId || '').trim());
  if (!workspace) {
    return Promise.reject(new Error('CLICKUP_CHAT_WORKSPACE_ID is required to post Chat'));
  }
  const payload = JSON.stringify({
    type: 'message',
    content_format: 'text/md',
    content: markdown,
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.clickup.com',
      path: `/api/v3/workspaces/${workspace}/chat/channels/${channel}/messages`,
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode });
          return;
        }
        reject(new Error(`ClickUp Chat HTTP ${res.statusCode}`));
      });
    });
    req.on('error', (err) => reject(new Error(err.message || 'ClickUp Chat request failed')));
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('ClickUp Chat request timeout'));
    });
    req.write(payload);
    req.end();
  });
}

module.exports = {
  escapeHtml,
  formatAnnotationHtml,
  generateDetailsHtml,
  classifyDeliveryTier,
  buildSubject,
  generateDigestSummaryHtml,
  generateDigestSummaryText,
  generateHtmlEmail,
  generatePlainText,
  postClickUpChatMessage,
};
