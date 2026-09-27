'use strict';

const {
  buildGrafanaDrilldownUrl,
  rewriteGrafanaUrls,
} = require('./grafanaLinks');

function classifyChatDeliveryTier(alerts, commonLabels) {
  const list = Array.isArray(alerts) ? alerts : [];
  const hasCritical =
    list.some(
      (alert) =>
        String(alert?.labels?.severity || '').toLowerCase() === 'critical'
    ) || String(commonLabels?.severity || '').toLowerCase() === 'critical';
  if (hasCritical) {
    return 'critical';
  }
  return 'digest';
}

function isClickUpChatConfigured({ token, channelId, enabled } = {}) {
  const enabledRaw = String(enabled ?? '').trim().toLowerCase();
  if (enabledRaw && !['1', 'true', 'yes', 'on'].includes(enabledRaw)) {
    return false;
  }
  return Boolean(String(token || '').trim() && String(channelId || '').trim());
}

function buildClickUpChatMarkdown({
  alertStatus,
  alertName,
  alerts,
  chatDeliveryTier,
  environment,
} = {}) {
  const status = String(alertStatus || 'unknown').toLowerCase();
  const statusEmoji = status === 'firing' ? '🚨' : '✅';
  const statusPrefix = status === 'resolved' ? '[RESOLVED] ' : '';
  const tierLabel = chatDeliveryTier === 'critical' ? 'CRITICAL' : 'Digest';
  const name = alertName || 'System Alert';
  const list = Array.isArray(alerts) ? alerts : [];
  const count = list.length;
  const dashboardUrl = buildGrafanaDrilldownUrl(environment, list[0]);

  const lines = [
    `${statusEmoji} ${statusPrefix}[${tierLabel}] ${name} (${count} alert${count !== 1 ? 's' : ''})`,
    '',
  ];

  if (chatDeliveryTier === 'digest') {
    lines.push(`**${count} alerts in this batch**`);
    list.forEach((alert, index) => {
      const alertNameLabel = alert?.labels?.alertname || `Alert ${index + 1}`;
      const severity = String(alert?.labels?.severity || 'unknown').toUpperCase();
      const firingStatus = String(alert?.status || status).toUpperCase();
      const summary = alert?.annotations?.summary || alertNameLabel;
      lines.push(
        `${index + 1}. **${alertNameLabel}** — ${severity} — ${firingStatus} — ${summary}`
      );
    });
    lines.push('');
  } else {
    const primary = list[0] || {};
    const summary = primary.annotations?.summary;
    const description = rewriteGrafanaUrls(
      primary.annotations?.description,
      environment
    );
    if (summary) {
      lines.push(summary);
    }
    if (description) {
      lines.push(description);
    }
    if (summary || description) {
      lines.push('');
    }
  }

  lines.push(`[View in Grafana](${dashboardUrl})`);

  const generatorUrls = [];
  list.forEach((alert) => {
    const url = rewriteGrafanaUrls(alert?.generatorURL, environment);
    if (url && !generatorUrls.includes(url)) {
      generatorUrls.push(url);
    }
  });
  generatorUrls.forEach((url) => {
    lines.push(`[Alert rule](${url})`);
  });

  return lines.join('\n');
}

function buildClickUpChatIntent({
  alerts,
  commonLabels,
  alertStatus,
  alertName,
  environment,
  token,
  channelId,
  enabled,
} = {}) {
  const chatDeliveryTier = classifyChatDeliveryTier(alerts, commonLabels);
  const status = String(alertStatus || '').toLowerCase();

  if (chatDeliveryTier === 'digest' && status === 'resolved') {
    return {
      intent: 'skip',
      clickupStatus: 'skipped_resolved_digest',
      chatDeliveryTier,
      markdown: null,
    };
  }

  const configured = isClickUpChatConfigured({ token, channelId, enabled });
  return {
    intent: 'post',
    clickupStatus: configured ? 'posted' : 'skipped_unconfigured',
    chatDeliveryTier,
    markdown: buildClickUpChatMarkdown({
      alertStatus: status,
      alertName,
      alerts,
      chatDeliveryTier,
      environment,
    }),
  };
}

module.exports = {
  buildClickUpChatIntent,
  buildClickUpChatMarkdown,
  classifyChatDeliveryTier,
  isClickUpChatConfigured,
};
