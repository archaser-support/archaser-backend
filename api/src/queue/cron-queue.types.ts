export const CRON_QUEUE_NAME = "archaser-cron";

/** Isolated from cron so Generate is not blocked behind scheduled cron jobs. */
export const CREDIT_ASOF_BACKFILL_QUEUE_NAME = "archaser-credit-asof-backfill";

/** Isolated VAT-basis account refresh (customer rollups + gaps). */
export const ACCOUNT_VAT_BASIS_REFRESH_QUEUE_NAME =
    "archaser-account-vat-basis-refresh";

export type CronRunNowJobData = {
    cronJobId: number;
    triggeredBy?: string;
    accountId?: number | null;
};

export type CronSyncSchedulesJobData = {
    reason: "startup" | "config-change" | "manual" | "lambda-cron-tick";
};

export type ArPostIngestDrainJobData = {
    accountId?: number;
    maxItems?: number;
};

export type CreditAsOfBackfillJobData = {
    accountId: number;
};

export type AccountVatBasisRefreshJobData = {
    accountId: number;
};
