import {
    Counter,
    Gauge,
    Histogram,
    type Registry,
} from "prom-client";

/**
 * Business / ops gauges historically exposed by Next `/api/metrics`.
 * Registered on the Nest API Prometheus registry so Grafana dashboards
 * (`archaser_*{instance="Staging"}`) receive data again.
 */
export type ArchaserBusinessMetrics = ReturnType<typeof createArchaserBusinessMetrics>;

export function createArchaserBusinessMetrics(register: Registry) {
// Cron Job Health Metrics
// ============================================================
    const cronJobsTotal = new Gauge({
    name: "archaser_cron_jobs_total",
    help: "Total number of cron jobs",
    registers: [register],
});

    const cronJobsRunning = new Gauge({
    name: "archaser_cron_jobs_running",
    help: "Number of currently running cron jobs",
    registers: [register],
});

    const cronJobsOverdue = new Gauge({
    name: "archaser_cron_jobs_overdue",
    help: "Number of overdue cron jobs",
    registers: [register],
});

    const cronJobsNotRun24h = new Gauge({
    name: "archaser_cron_jobs_not_run_24h",
    help: "Number of cron jobs not run in the last 24 hours",
    registers: [register],
});

    const cronJobSuccessRate = new Gauge({
    name: "archaser_cron_job_success_rate",
    help: "Overall cron job success rate (30 days)",
    registers: [register],
});

    const cronJobExecutions = new Counter({
    name: "archaser_cron_job_executions_total",
    help: "Total cron job executions",
    labelNames: ["job_name", "status"],
    registers: [register],
});

    const cronJobDuration = new Gauge({
    name: "archaser_cron_job_duration_seconds",
    help: "Last execution duration of cron jobs in seconds",
    labelNames: ["job_name"],
    registers: [register],
});

    const cronJobSuccessCount30d = new Gauge({
        name: "archaser_cron_job_success_count_30d",
        help: "Cron job success count (rolling 30d) from Postgres",
        labelNames: ["job_name"],
        registers: [register],
    });

    const cronJobFailureCount30d = new Gauge({
        name: "archaser_cron_job_failure_count_30d",
        help: "Cron job failure count (rolling 30d) from Postgres",
        labelNames: ["job_name"],
        registers: [register],
    });

    const cronJobTimeoutCount30d = new Gauge({
        name: "archaser_cron_job_timeout_count_30d",
        help: "Cron job timeout count (rolling 30d) from Postgres",
        labelNames: ["job_name"],
        registers: [register],
    });

    const cronJobLastRun = new Gauge({
    name: "archaser_cron_job_last_run_timestamp_seconds",
    help: "Timestamp of the last cron job run",
    labelNames: ["job_name"],
    registers: [register],
});

    const cronJobNextRun = new Gauge({
    name: "archaser_cron_job_next_run_timestamp_seconds",
    help: "Timestamp of the next scheduled cron job run",
    labelNames: ["job_name"],
    registers: [register],
});

// ============================================================
// Email/SMS Activity Metrics
// ============================================================
    const emailsSent = new Gauge({
    name: "archaser_emails_sent_24h",
    help: "Emails sent in the last 24 hours",
    registers: [register],
});

    const emailsFailed = new Gauge({
    name: "archaser_emails_failed_24h",
    help: "Emails failed in the last 24 hours",
    registers: [register],
});

    const emailsBounced = new Gauge({
    name: "archaser_emails_bounced_24h",
    help: "Emails bounced in the last 24 hours",
    registers: [register],
});

    const emailContactsTotal24h = new Gauge({
    name: "archaser_email_contacts_total_24h",
    help: "Total email contacts processed in the last 24 hours",
    registers: [register],
});

    const emailContactsDelivered24h = new Gauge({
    name: "archaser_email_contacts_delivered_24h",
    help: "Email contacts delivered in the last 24 hours",
    registers: [register],
});

    const emailContactsOpened24h = new Gauge({
    name: "archaser_email_contacts_opened_24h",
    help: "Email contacts opened in the last 24 hours",
    registers: [register],
});

    const emailContactsClicked24h = new Gauge({
    name: "archaser_email_contacts_clicked_24h",
    help: "Email contacts clicked in the last 24 hours",
    registers: [register],
});

    const emailContactsBounced24h = new Gauge({
    name: "archaser_email_contacts_bounced_24h",
    help: "Email contacts bounced in the last 24 hours",
    registers: [register],
});

    const emailContactsFailed24h = new Gauge({
    name: "archaser_email_contacts_failed_24h",
    help: "Email contacts failed in the last 24 hours",
    registers: [register],
});

    const smsSent = new Gauge({
    name: "archaser_sms_sent_24h",
    help: "SMS sent in the last 24 hours",
    registers: [register],
});

    const smsFailed = new Gauge({
    name: "archaser_sms_failed_24h",
    help: "SMS failed in the last 24 hours",
    registers: [register],
});

    const emailSmtpConnected = new Gauge({
    name: "archaser_email_smtp_connected",
    help: "SMTP connection status (1 = connected, 0 = disconnected/misconfigured)",
    registers: [register],
});

    const emailSesConnected = new Gauge({
    name: "archaser_email_ses_connected",
    help: "SES connection status via SMTP compatibility (1 = connected, 0 = disconnected/misconfigured)",
    registers: [register],
});

    const smsProviderStatus = new Gauge({
    name: "archaser_sms_provider_status",
    help: "Per-provider SMS connection status (2=connected, 1=misconfigured, 0=disconnected)",
    labelNames: ["provider_id", "provider_name", "provider_type"],
    registers: [register],
});

    const smsProvidersConfiguredTotal = new Gauge({
    name: "archaser_sms_providers_configured_total",
    help: "Total active SMS providers configured",
    registers: [register],
});

    const activitiesStuck = new Gauge({
    name: "archaser_activities_stuck",
    help: "Number of stuck activities",
    registers: [register],
});

    const systemActivitiesCreated24h = new Gauge({
    name: "archaser_system_activities_created_24h",
    help: "Number of system-generated activities created in the last 24 hours",
    registers: [register],
});

    const hoursSinceLastSystemActivity = new Gauge({
    name: "archaser_hours_since_last_system_activity",
    help: "Hours since the last system-generated activity was created",
    registers: [register],
});

// ============================================================
// Import Job Metrics
// ============================================================
    const importJobsPending = new Gauge({
    name: "archaser_import_jobs_pending",
    help: "Number of pending import jobs",
    registers: [register],
});

    const importJobsStuck = new Gauge({
    name: "archaser_import_jobs_stuck",
    help: "Number of stuck import jobs (pending > 1 hour)",
    labelNames: ["source"],
    registers: [register],
});

    const importJobsSuccess24h = new Gauge({
    name: "archaser_import_jobs_24h",
    help: "Import jobs in the last 24 hours",
    registers: [register],
});

    const importSuccessRate = new Gauge({
    name: "archaser_import_success_rate",
    help: "Overall import success rate",
    registers: [register],
});

    const importRecordsPerHour = new Gauge({
    name: "archaser_import_records_per_hour",
    help: "Import processing rate (records per hour)",
    registers: [register],
});

// ============================================================
// Error/Log Metrics
// ============================================================
    const applicationErrors1h = new Gauge({
    name: "archaser_errors_1h",
    help: "Application errors in the last hour",
    registers: [register],
});

    const applicationErrors24h = new Gauge({
    name: "archaser_errors_24h",
    help: "Application errors in the last 24 hours",
    registers: [register],
});

    const applicationWarnings24h = new Gauge({
    name: "archaser_warnings_24h",
    help: "Application warnings in the last 24 hours",
    registers: [register],
});

// ============================================================
// Collection Period Health Metrics
// ============================================================
    const activeCollectionPeriods = new Gauge({
    name: "archaser_active_collection_periods",
    help: "Number of active collection periods",
    registers: [register],
});

    const automationStuckNoContacts = new Gauge({
    name: "archaser_automation_stuck_no_contacts",
    help: "Collection periods stuck due to no contacts",
    registers: [register],
});

    const periodsWithoutActivities = new Gauge({
    name: "archaser_periods_without_activities",
    help: "Automated periods without scheduled activities",
    registers: [register],
});

    const overdueActivityCreation = new Gauge({
    name: "archaser_overdue_activity_creation",
    help: "Collection periods with overdue activity creation",
    registers: [register],
});

// ============================================================
// Dispute Metrics
// ============================================================
    const disputesOpen = new Gauge({
    name: "archaser_disputes_open",
    help: "Number of open disputes",
    registers: [register],
});

    const disputesPending = new Gauge({
    name: "archaser_disputes_pending",
    help: "Number of pending disputes (open + in progress)",
    registers: [register],
});

    const disputesCreated24h = new Gauge({
    name: "archaser_disputes_created_24h",
    help: "Disputes created in the last 24 hours",
    registers: [register],
});

    const disputesResolved24h = new Gauge({
    name: "archaser_disputes_resolved_24h",
    help: "Disputes resolved in the last 24 hours",
    registers: [register],
});

    const disputesStale = new Gauge({
    name: "archaser_disputes_stale",
    help: "Disputes older than 7 days (potentially stuck)",
    registers: [register],
});

// ============================================================
// Promise to Pay Metrics
// ============================================================
    const ptpActive = new Gauge({
    name: "archaser_ptp_active",
    help: "Active Promise to Pay commitments",
    registers: [register],
});

    const ptpDueToday = new Gauge({
    name: "archaser_ptp_due_today",
    help: "Promise to Pay due today",
    registers: [register],
});

    const ptpBroken = new Gauge({
    name: "archaser_ptp_broken",
    help: "Broken Promise to Pay (past due with outstanding balance)",
    registers: [register],
});

// ============================================================
// Contact Health Metrics
// ============================================================
    const contactsHighBounce = new Gauge({
    name: "archaser_contacts_high_bounce",
    help: "Contacts with high email bounce count (>=3)",
    registers: [register],
});

    const contactsHighSMSFailure = new Gauge({
    name: "archaser_contacts_high_sms_failure",
    help: "Contacts with high SMS failure count (>=3)",
    registers: [register],
});

    const contactsLowCommScore = new Gauge({
    name: "archaser_contacts_low_comm_score",
    help: "Contacts with low communication score (<0.5)",
    registers: [register],
});

    const recentEmailBounces = new Gauge({
    name: "archaser_recent_email_bounces_24h",
    help: "Contacts with email bounces in the last 24 hours",
    registers: [register],
});

    const recentSMSFailures = new Gauge({
    name: "archaser_recent_sms_failures_24h",
    help: "Contacts with SMS failures in the last 24 hours",
    registers: [register],
});

// ============================================================
// Database Health Metrics
// ============================================================
    const dbPostgresConnected = new Gauge({
    name: "archaser_db_postgres_connected",
    help: "PostgreSQL connection status (1 = connected, 0 = disconnected)",
    registers: [register],
});

    const dbPostgresConnections = new Gauge({
    name: "archaser_db_postgres_connections",
    help: "Number of active PostgreSQL connections",
    registers: [register],
});

    const dbMongodbConnected = new Gauge({
    name: "archaser_db_mongodb_connected",
    help: "MongoDB connection status (1 = connected, 0 = disconnected)",
    registers: [register],
});

    const dbMongodbConnections = new Gauge({
    name: "archaser_db_mongodb_connections",
    help: "Number of active MongoDB connections",
    registers: [register],
});

// ============================================================
// Security Metrics
// ============================================================
    const securityAttacksTotal = new Counter({
    name: "archaser_security_attacks_total",
    help: "Total number of malicious payloads or security attacks detected",
    labelNames: ["type", "source"],
    registers: [register],
});

// ============================================================
// Billing Connector Metrics
// ============================================================
    const billingConnectorSyncTotal = new Counter({
    name: "archaser_billing_connector_sync_total",
    help: "Total billing connector sync runs",
    labelNames: ["provider", "status", "sync_mode", "trigger"],
    registers: [register],
});

    const billingConnectorSyncDuration = new Histogram({
    name: "archaser_billing_connector_sync_duration_seconds",
    help: "Billing connector sync duration in seconds",
    labelNames: ["provider", "sync_mode"],
    registers: [register],
});

    const billingConnectorErrorsTotal = new Counter({
    name: "archaser_billing_connector_errors_total",
    help: "Billing connector errors by type",
    labelNames: ["provider", "error_type", "sync_mode"],
    registers: [register],
});

    const billingConnectorRecordsProcessed = new Counter({
    name: "archaser_billing_connector_records_processed_total",
    help: "Billing connector records processed",
    labelNames: ["provider", "entity_type", "result"],
    registers: [register],
});

    const billingConnectorConnectorsInError = new Gauge({
    name: "archaser_billing_connector_connectors_in_error",
    help: "Number of billing connectors in Error status",
    labelNames: ["provider"],
    registers: [register],
});

    const billingConnectorLastCheckpointTimestamp = new Gauge({
    name: "archaser_billing_connector_last_checkpoint_timestamp",
    help: "Unix timestamp of the most recent connector checkpoint",
    labelNames: ["provider"],
    registers: [register],
});

    const billingConnectorStaleRunningCount = new Gauge({
    name: "archaser_billing_connector_stale_running_count",
    help: "Number of stale RUNNING connector sync executions",
    registers: [register],
});

    const billingConnectorStaleIncrementalCount = new Gauge({
    name: "archaser_billing_connector_stale_incremental_count",
    help: "Incremental connectors with no successful sync in the last 24 hours",
    registers: [register],
});

    const billingConnectorSyncEnabledUnmappedCount = new Gauge({
    name: "archaser_billing_connector_sync_enabled_unmapped_count",
    help: "Sync-enabled connectors with incomplete field mappings",
    registers: [register],
});

    return {
        cronJobsTotal,
        cronJobsRunning,
        cronJobsOverdue,
        cronJobsNotRun24h,
        cronJobSuccessRate,
        cronJobExecutions,
        cronJobDuration,
        cronJobSuccessCount30d,
        cronJobFailureCount30d,
        cronJobTimeoutCount30d,
        cronJobLastRun,
        cronJobNextRun,
        emailsSent,
        emailsFailed,
        emailsBounced,
        emailContactsTotal24h,
        emailContactsDelivered24h,
        emailContactsOpened24h,
        emailContactsClicked24h,
        emailContactsBounced24h,
        emailContactsFailed24h,
        smsSent,
        smsFailed,
        emailSmtpConnected,
        emailSesConnected,
        smsProviderStatus,
        smsProvidersConfiguredTotal,
        activitiesStuck,
        systemActivitiesCreated24h,
        hoursSinceLastSystemActivity,
        importJobsPending,
        importJobsStuck,
        importJobsSuccess24h,
        importSuccessRate,
        importRecordsPerHour,
        applicationErrors1h,
        applicationErrors24h,
        applicationWarnings24h,
        activeCollectionPeriods,
        automationStuckNoContacts,
        periodsWithoutActivities,
        overdueActivityCreation,
        disputesOpen,
        disputesPending,
        disputesCreated24h,
        disputesResolved24h,
        disputesStale,
        ptpActive,
        ptpDueToday,
        ptpBroken,
        contactsHighBounce,
        contactsHighSMSFailure,
        contactsLowCommScore,
        recentEmailBounces,
        recentSMSFailures,
        dbPostgresConnected,
        dbPostgresConnections,
        dbMongodbConnected,
        dbMongodbConnections,
        securityAttacksTotal,
        billingConnectorSyncTotal,
        billingConnectorSyncDuration,
        billingConnectorErrorsTotal,
        billingConnectorRecordsProcessed,
        billingConnectorConnectorsInError,
        billingConnectorLastCheckpointTimestamp,
        billingConnectorStaleRunningCount,
        billingConnectorStaleIncrementalCount,
        billingConnectorSyncEnabledUnmappedCount,
    };
}
