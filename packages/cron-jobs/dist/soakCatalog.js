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
/** Documented parity gaps — accepted at cutover (warn/info); deepen later if product needs. */
exports.WORKER_SOAK_KNOWN_GAPS = [
    {
        name: "Process Due Notifications",
        gap: "Creates SCHEDULED activities; channel send deferred to AWM",
        severity: "info",
    },
    {
        name: "Process Automated Collection Periods",
        gap: "Flag/transitions only (matches original); AWM creates/sends next activities",
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
        nginxMarker: "location ^~ /api/accounts/",
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
