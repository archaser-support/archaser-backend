export declare const CRON_QUEUE_NAME = "archaser-cron";
export type CronRunNowJobData = {
    cronJobId: number;
    triggeredBy?: string;
    accountId?: number | null;
};
export type CronSyncSchedulesJobData = {
    reason: "startup" | "config-change" | "manual";
};
