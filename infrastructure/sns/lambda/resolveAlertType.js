'use strict';

/**
 * Known /api/alert-details type keys.
 * Keep in sync with AlertDetailsService handlers.
 */
const KNOWN_ALERT_DETAIL_TYPES = new Set([
  'automation_stuck_no_contacts',
  'cron_jobs_overdue',
  'cron_jobs_not_run_24h',
  'stuck_activities',
  'periods_without_activities',
  'overdue_activity_creation',
  'high_email_bounces',
  'high_sms_failures',
  'no_system_activities_24h',
  'stuck_import_jobs',
  'stale_disputes',
]);

/** After normalizeCandidate(), map common title/UID shapes onto known types. */
const NORMALIZED_ALIASES = {
  stuck_activities_detected: 'stuck_activities',
  automated_periods_without_activities: 'periods_without_activities',
  periods_without_activities: 'periods_without_activities',
  overdue_activity_creation: 'overdue_activity_creation',
  automation_stuck_no_contacts: 'automation_stuck_no_contacts',
  cron_jobs_overdue: 'cron_jobs_overdue',
  cron_jobs_not_run_in_24_hours: 'cron_jobs_not_run_24h',
  cron_jobs_not_run_24_hours: 'cron_jobs_not_run_24h',
  cron_jobs_not_run_24h: 'cron_jobs_not_run_24h',
  high_email_bounce_rate: 'high_email_bounces',
  high_email_bounces: 'high_email_bounces',
  high_sms_failure_rate: 'high_sms_failures',
  high_sms_failures: 'high_sms_failures',
  no_system_activities_created_in_24_hours: 'no_system_activities_24h',
  no_system_activities_24h: 'no_system_activities_24h',
  stuck_import_jobs: 'stuck_import_jobs',
  stale_disputes_detected: 'stale_disputes',
  stale_disputes: 'stale_disputes',
};

function normalizeCandidate(raw) {
  if (raw == null) {
    return null;
  }
  let s = String(raw).trim();
  if (!s) {
    return null;
  }
  // Strip env suffixes from Grafana rule UIDs: overdue-activity-creation-prod
  s = s.replace(/-(prod|stag|staging|production)$/i, '');
  // CamelCase → kebab pieces
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
  return s || null;
}

function resolveFromNormalized(normalized) {
  if (!normalized) {
    return null;
  }
  if (KNOWN_ALERT_DETAIL_TYPES.has(normalized)) {
    return normalized;
  }
  if (Object.prototype.hasOwnProperty.call(NORMALIZED_ALIASES, normalized)) {
    return NORMALIZED_ALIASES[normalized];
  }
  return null;
}

/**
 * Resolve /api/alert-details ?type= for a Grafana alert.
 * Prefer annotations.alert_details_type, then UID, then alertname/title.
 */
function resolveAlertDetailsType(alert, fallbackName) {
  const annotated = String(alert?.annotations?.alert_details_type || '').trim();
  if (annotated && KNOWN_ALERT_DETAIL_TYPES.has(annotated)) {
    return annotated;
  }

  const candidates = [
    annotated,
    alert?.labels?.uid,
    alert?.labels?.grafana_rule_uid,
    alert?.labels?.rulename,
    alert?.labels?.alertname,
    fallbackName,
  ];

  for (const candidate of candidates) {
    const resolved = resolveFromNormalized(normalizeCandidate(candidate));
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

module.exports = {
  KNOWN_ALERT_DETAIL_TYPES,
  normalizeCandidate,
  resolveAlertDetailsType,
};
