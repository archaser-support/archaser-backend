import { Counter, type Registry } from "prom-client";

export function registerCronFrozenAccountMetrics(register: Registry) {
    const cronAccountsSkippedFrozenTotal = new Counter({
        name: "archaser_cron_accounts_skipped_frozen_total",
        help: "Accounts skipped in cron runs because they were frozen (import/sync/as-of backfill in progress)",
        labelNames: ["job_name"],
        registers: [register],
    });

    return { cronAccountsSkippedFrozenTotal };
}

export type CronFrozenAccountMetrics = ReturnType<
    typeof registerCronFrozenAccountMetrics
>;
