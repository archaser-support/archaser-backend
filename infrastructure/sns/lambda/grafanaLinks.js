'use strict';

const STAGING_BASE = 'https://grafana.staging.archaser.com';
const PRODUCTION_BASE = 'https://grafana.portal.archaser.com';

/** Hosts that must never be used for Grafana links (Next app / legacy). */
const FORBIDDEN_GRAFANA_HOSTS = new Set([
  'grafana.archaser.com',
  'grafana.production.archaser.com',
  'www.grafana.archaser.com',
]);

function normalizeEnvironment(environment) {
  return String(environment || 'production').toLowerCase() === 'staging'
    ? 'staging'
    : 'production';
}

/** Prefer alert labels (instance / grafana_folder) over Lambda ENVIRONMENT. */
function resolveEnvironment(environment, alert) {
  const fromLabels = [
    alert?.labels?.instance,
    alert?.labels?.grafana_folder,
    alert?.labels?.environment,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  if (fromLabels.includes('staging')) {
    return 'staging';
  }
  if (
    fromLabels.includes('production') ||
    fromLabels.includes('prod') ||
    fromLabels.includes('portal')
  ) {
    return 'production';
  }
  return normalizeEnvironment(environment);
}

function defaultGrafanaBaseUrl(environment) {
  return normalizeEnvironment(environment) === 'staging'
    ? STAGING_BASE
    : PRODUCTION_BASE;
}

function isForbiddenGrafanaBase(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return FORBIDDEN_GRAFANA_HOSTS.has(host);
  } catch {
    return true;
  }
}

function grafanaBaseUrl(environment) {
  const env = normalizeEnvironment(environment);
  const fallback = defaultGrafanaBaseUrl(env);
  const configured = String(process.env.GRAFANA_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (!configured) {
    return fallback;
  }
  if (isForbiddenGrafanaBase(configured)) {
    return fallback;
  }
  // Staging Lambda must not keep a production portal override (and vice versa).
  try {
    const host = new URL(configured).hostname.toLowerCase();
    if (env === 'staging' && host === 'grafana.portal.archaser.com') {
      return STAGING_BASE;
    }
    if (env === 'production' && host === 'grafana.staging.archaser.com') {
      return PRODUCTION_BASE;
    }
  } catch {
    return fallback;
  }
  return configured;
}

function grafanaDashboardPath(environment, alert) {
  const env = resolveEnvironment(environment, alert);
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
  const env = resolveEnvironment(environment, alert);
  const baseUrl = grafanaBaseUrl(env);
  const path = grafanaDashboardPath(env, alert);
  return `${baseUrl}${path}?orgId=1&from=now-24h&to=now&timezone=browser&refresh=1m`;
}

function rewriteGrafanaUrls(text, environment, alert) {
  if (!text) {
    return text;
  }
  const baseUrl = grafanaBaseUrl(resolveEnvironment(environment, alert));
  return String(text)
    .replace(/https?:\/\/grafana\.archaser\.com/gi, baseUrl)
    .replace(/https?:\/\/grafana\.production\.archaser\.com/gi, baseUrl)
    .replace(/https?:\/\/grafana\.portal\.archaser\.com/gi, baseUrl)
    .replace(/https?:\/\/grafana\.staging\.archaser\.com/gi, baseUrl)
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
  STAGING_BASE,
  PRODUCTION_BASE,
  grafanaBaseUrl,
  resolveEnvironment,
  grafanaDashboardPath,
  buildGrafanaDrilldownUrl,
  rewriteGrafanaUrls,
};
