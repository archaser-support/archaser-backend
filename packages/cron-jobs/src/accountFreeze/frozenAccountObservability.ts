import type { Counter } from "prom-client";

import { jobLog } from "../logging/jobLog";
import type { CronFrozenAccountMetrics } from "./frozenAccountMetrics";

export type FrozenAccountSkipLogInput = {
    jobName: string;
    frozenAccountIds: number[];
    frozenCount: number;
    skippedCount: number;
};

export function logFrozenAccountSkips(input: FrozenAccountSkipLogInput): void {
    if (input.skippedCount <= 0) {
        return;
    }
    jobLog("frozen-account", "info", "Cron skipped frozen accounts", {
        jobName: input.jobName,
        frozenAccountIds: input.frozenAccountIds,
        frozenCount: input.frozenCount,
        skippedCount: input.skippedCount,
    });
}

export function recordFrozenAccountSkips(
    counter: Counter<"job_name">,
    jobName: string,
    skippedCount: number
): void {
    if (skippedCount <= 0) {
        return;
    }
    counter.inc({ job_name: jobName }, skippedCount);
}

export function reportFrozenAccountSkips(
    metrics: CronFrozenAccountMetrics,
    input: FrozenAccountSkipLogInput
): void {
    logFrozenAccountSkips(input);
    recordFrozenAccountSkips(
        metrics.cronAccountsSkippedFrozenTotal,
        input.jobName,
        input.skippedCount
    );
}
