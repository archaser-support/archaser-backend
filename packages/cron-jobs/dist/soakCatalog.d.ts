/**
 * Canonical CronJob.name values expected in Postgres CronJob rows.
 * Keep in sync with historical cronManager cases + admin seed data.
 */
export declare const EXPECTED_CRON_JOB_NAMES: readonly ["Activity Workflow Manager", "Process Due Notifications", "Over Due Invoice", "Process Overdue Invoices", "Compute Customer Overdue Metrics", "Process Notification Rules", "Move Collection To Next Category", "Process Automated Collection Periods", "Fix Closed Collection Data", "Close Zero Outstanding Debt Invoices", "Inforu SMS Status Check", "Report Scheduler", "Credit Dashboard Daily Snapshot", "Fetch Currency Rates", "Customer Policy Trend Daily Snapshot", "Insurance Policy Trend Daily Snapshot", "Compute Gap In Base Currency", "Sync Billing Connectors"];
export type ExpectedCronJobName = (typeof EXPECTED_CRON_JOB_NAMES)[number];
/** Documented parity gaps — soak must accept or close these before ENABLE_CRON_JOBS=false. */
export declare const WORKER_SOAK_KNOWN_GAPS: Array<{
    name: string;
    gap: string;
    severity: "info" | "warn" | "block";
}>;
export type PathFlipFlag = {
    id: string;
    envVar: string;
    nginxMarker: string;
    description: string;
};
export declare const PATH_FLIP_FLAGS: PathFlipFlag[];
export declare function assessCronHandlerCoverage(): {
    ok: boolean;
    missing: string[];
    ported: string[];
};
export declare function readPathFlipEnv(env?: NodeJS.ProcessEnv): Array<PathFlipFlag & {
    enabled: boolean;
}>;
