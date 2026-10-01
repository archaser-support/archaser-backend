'use strict';

function grafanaBaseUrl(environment) {
  const env =
    String(environment || 'production').toLowerCase() === 'staging'
      ? 'staging'
      : 'production';
  const configured = String(process.env.GRAFANA_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (configured) {
    return configured;
  }
  return env === 'staging'
    ? 'https://grafana.staging.archaser.com'
    : 'https://grafana.portal.archaser.com';
}

function grafanaDashboardPath(environment, alert) {
  const env =
    String(environment || 'production').toLowerCase() === 'staging'
      ? 'staging'
      : 'production';
  const type = String(alert?.labels?.type || '').toLowerCase();
  const name = String(
    alert?.labels?.alertname || alert?.annotations?.summary || ''
  ).toLowerCase();

  if (env === 'staging') {
    if (type === 'billing_connector' || name.includes('billing connector')) {
      return '/d/archaser-billing-connector-stag/billing-connector-staging';
    }
    if (name.includes('postgres') || name.includes('postgresql')) {
      return '/d/archaser-postgres-logs-stag/postgres-logs-staging';
    }
    if (type === 'cron' || name.includes('cron')) {
      return '/d/archaser-cron-v1-staging/cron-health-staging';
    }
    if (
      type === 'email' ||
      type === 'sms' ||
      name.includes('email') ||
      name.includes('sms')
    ) {
      return '/d/archaser-comm-unified-staging/communications-staging';
    }
    if (name.includes('application error')) {
      return '/d/archaser-prometheus-v1-staging/infrastructure-staging';
    }
    return '/d/alert-drilldown-staging/alert-drilldown-staging';
  }

  if (type === 'billing_connector' || name.includes('billing connector')) {
    return '/d/archaser-billing-connector-prod/billing-connector-production';
  }
  if (name.includes('postgres') || name.includes('postgresql')) {
    return '/d/archaser-postgres-logs-prod/postgres-logs-production';
  }
  if (type === 'cron' || name.includes('cron')) {
    return '/d/archaser-cron-v1-prod/cron-health-production';
  }
  if (
    type === 'email' ||
    type === 'sms' ||
    name.includes('email') ||
    name.includes('sms')
  ) {
    return '/d/archaser-comm-unified-prod/communications-production';
  }
  if (name.includes('application error')) {
    return '/d/archaser-prometheus-v1-prod/infrastructure-production';
  }
  return '/d/alert-drilldown-prod/alert-drilldown-production';
}

function buildGrafanaDrilldownUrl(environment, alert) {
  const baseUrl = grafanaBaseUrl(environment);
  const path = grafanaDashboardPath(environment, alert);
  return `${baseUrl}${path}?orgId=1&from=now-24h&to=now&timezone=browser&refresh=1m`;
}

function rewriteGrafanaUrls(text, environment) {
  if (!text) {
    return text;
  }
  const baseUrl = grafanaBaseUrl(environment);
  return String(text)
    .replace(/https?:\/\/grafana\.archaser\.com/gi, baseUrl)
    .replace(/https?:\/\/grafana\.production\.archaser\.com/gi, baseUrl)
    .replace(/https?:\/\/grafana\.portal\.archaser\.com/gi, baseUrl)
    .replace(
      /\/d\/alert-drilldown-prod\/alert-data-drilldown-production/gi,
      '/d/alert-drilldown-prod/alert-drilldown-production'
    )
    .replace(
      /\/d\/alert-drilldown-staging\/alert-data-drilldown-staging/gi,
      '/d/alert-drilldown-staging/alert-drilldown-staging'
    )
    .replace(/(^|[\s("'])(\/d\/[A-Za-z0-9_./-]+)/g, `$1${baseUrl}$2`);
}

module.exports = {
  grafanaBaseUrl,
  grafanaDashboardPath,
  buildGrafanaDrilldownUrl,
  rewriteGrafanaUrls,
};
