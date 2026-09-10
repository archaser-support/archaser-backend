import type { PrismaClient } from "@prisma/client";

import { jobLog } from "../logging/jobLog";

/** Idle threshold for Processing ImportJob rows (matches billing connector RUNNING sweeper). */
export const STALE_IMPORT_JOB_IDLE_HOURS = 2;

export function buildStaleImportJobErrorMessage(
    hours: number = STALE_IMPORT_JOB_IDLE_HOURS
): string {
    return `Import job marked Failed: no progress for ${hours} hours (stale Processing sweeper)`;
}

/** Stable default message (2-hour idle) for sweeper + ops clear. */
export const STALE_IMPORT_JOB_ERROR_MESSAGE =
    buildStaleImportJobErrorMessage(STALE_IMPORT_JOB_IDLE_HOURS);

export type SweepStaleProcessingImportJobsOptions = {
    prisma: PrismaClient;
    /** When set, only sweep jobs for this account (import-start path). */
    accountId?: number;
    olderThanHours?: number;
    now?: Date;
};

export type SweepStaleProcessingImportJobsResult = {
    sweptCount: number;
    accountIds: number[];
};

/**
 * Marks idle Processing ImportJob rows as Failed so cron freeze and import 409
 * cannot stick forever after a crashed or abandoned import.
 */
export async function sweepStaleProcessingImportJobs(
    options: SweepStaleProcessingImportJobsOptions
): Promise<SweepStaleProcessingImportJobsResult> {
    const hours = options.olderThanHours ?? STALE_IMPORT_JOB_IDLE_HOURS;
    const now = options.now ?? new Date();
    const idleBefore = new Date(now.getTime() - hours * 60 * 60 * 1000);

    const stale = await options.prisma.importJob.findMany({
        where: {
            status: "Processing",
            modified_at: { lt: idleBefore },
            ...(options.accountId != null
                ? { account_id: options.accountId }
                : {}),
        },
        select: { id: true, account_id: true },
    });

    if (stale.length === 0) {
        return { sweptCount: 0, accountIds: [] };
    }

    const ids = stale.map((job) => job.id);
    const accountIds = [
        ...new Set(stale.map((job) => job.account_id)),
    ].sort((a, b) => a - b);

    const updated = await options.prisma.importJob.updateMany({
        where: {
            id: { in: ids },
            status: "Processing",
        },
        data: {
            status: "Failed",
            error_message: buildStaleImportJobErrorMessage(hours),
            completed_at: now,
            modified_at: now,
        },
    });

    const sweptCount = updated.count;
    if (sweptCount > 0) {
        jobLog(
            "stale-import-job",
            "info",
            "Swept stale Processing ImportJobs",
            {
                sweptCount,
                accountCount: accountIds.length,
                accountIds,
                olderThanHours: hours,
                accountIdFilter: options.accountId ?? null,
            }
        );
    }

    return { sweptCount, accountIds };
}
