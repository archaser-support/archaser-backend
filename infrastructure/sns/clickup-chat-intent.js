'use strict';

function normalizeSeverity(value) {
  return String(value || '').toLowerCase();
}

function classifyChatDeliveryTier(alerts, commonLabels) {
  const list = Array.isArray(alerts) ? alerts : [];
  const hasCritical =
    list.some((alert) => normalizeSeverity(alert?.labels?.severity) === 'critical') ||
    normalizeSeverity(commonLabels?.severity) === 'critical';
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

function buildGrafanaDrilldownUrl(environment) {
  const env = String(environment || 'production').toLowerCase() === 'staging' ? 'staging' : 'production';
  const dashboardUid = env === 'staging' ? 'alert-drilldown-staging' : 'alert-drilldown-prod';
  const dashboardSlug = env === 'staging' ? 'alert-data-drilldown-staging' : 'alert-data-drilldown-production';
  return `https://grafana.archaser.com/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-24h&to=now&timezone=browser&refresh=1m`;
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
  const dashboardUrl = buildGrafanaDrilldownUrl(environment);

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
      lines.push(`${index + 1}. **${alertNameLabel}** — ${severity} — ${firingStatus} — ${summary}`);
    });
    lines.push('');
  } else {
    const primary = list[0] || {};
    const summary = primary.annotations?.summary;
    const description = primary.annotations?.description;
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
    const url = alert?.generatorURL;
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
  buildGrafanaDrilldownUrl,
  classifyChatDeliveryTier,
  isClickUpChatConfigured,
};
