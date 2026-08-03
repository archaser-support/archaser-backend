"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PATH_FLIP_FLAGS = exports.WORKER_SOAK_KNOWN_GAPS = exports.EXPECTED_CRON_JOB_NAMES = void 0;
exports.assessCronHandlerCoverage = assessCronHandlerCoverage;
exports.readPathFlipEnv = readPathFlipEnv;
const handlers_1 = require("./handlers");
/**
 * Canonical CronJob.name values expected in Postgres CronJob rows.
 * Keep in sync with historical cronManager cases + admin seed data.
 */
exports.EXPECTED_CRON_JOB_NAMES = [
    "Activity Workflow Manager",
    "Process Due Notifications",
    "Over Due Invoice",
    "Process Overdue Invoices",
    "Compute Customer Overdue Metrics",
    "Process Notification Rules",
    "Move Collection To Next Category",
    "Process Automated Collection Periods",
    "Fix Closed Collection Data",
    "Close Zero Outstanding Debt Invoices",
    "Inforu SMS Status Check",
    "Report Scheduler",
    "Credit Dashboard Daily Snapshot",
    "Fetch Currency Rates",
    "Customer Policy Trend Daily Snapshot",
    "Insurance Policy Trend Daily Snapshot",
    "Compute Gap In Base Currency",
    "Sync Billing Connectors",
];
/** Documented parity gaps — soak must accept or close these before ENABLE_CRON_JOBS=false. */
exports.WORKER_SOAK_KNOWN_GAPS = [
    {
        name: "Activity Workflow Manager",
        gap: "Email send stubbed; template variable fill incomplete; schedule calc simplified; CI/realtime skipped",
        severity: "warn",
    },
    {
        name: "Process Due Notifications",
        gap: "Creates SCHEDULED activities; template fill incomplete; channel send deferred to AWM",
        severity: "warn",
    },
    {
        name: "Process Automated Collection Periods",
        gap: "State flags only; activity create/send deferred to AWM",
        severity: "warn",
    },
    {
        name: "Process Notification Rules",
        gap: "In-app delivery live; SMTP email stubbed",
        severity: "warn",
    },
    {
        name: "Report Scheduler",
        gap: "Full execute needs REPORTS_SERVICE_URL + INTERNAL_SERVICE_SECRET + reports /internal execute",
        severity: "warn",
    },
    {
        name: "Inforu SMS Status Check",
        gap: "Slim delivery update; allowNextAutomatedActivity deferred",
        severity: "info",
    },
];
exports.PATH_FLIP_FLAGS = [
    {
        id: "sms",
        envVar: "USE_SMS_NEST_REWRITE",
        nginxMarker: "location ^~ /api/sms/",
        description: "SMS Nest path flip (D36)",
    },
    {
        id: "connectors",
        envVar: "USE_CONNECTORS_NEST_REWRITE",
        nginxMarker: "location ^~ /api/entities/accounts/",
        description: "Connectors Nest path flip (D70)",
    },
    {
        id: "reports",
        envVar: "USE_REPORTS_NEST_REWRITE",
        nginxMarker: "location ^~ /api/reports/",
        description: "Reports Nest path flip",
    },
];
function assessCronHandlerCoverage() {
    const missing = [];
    const ported = [];
    for (const name of exports.EXPECTED_CRON_JOB_NAMES) {
        if ((0, handlers_1.isCronJobPorted)(name)) {
            ported.push(name);
        }
        else {
            missing.push(name);
        }
    }
    return { ok: missing.length === 0, missing, ported };
}
function readPathFlipEnv(env = process.env) {
    return exports.PATH_FLIP_FLAGS.map((flag) => ({
        ...flag,
        enabled: env[flag.envVar] === "true",
    }));
}
