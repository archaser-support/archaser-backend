import type { Prisma, PrismaClient } from "@prisma/client";
import { parseExpression } from "cron-parser";

export type CronJobRunStatsRow = {
    id: number;
    cron_expression: string;
    timeout_period_seconds: number;
    last_execution_duration_seconds: number | null;
    average_execution_duration_seconds: number | null;
    min_execution_duration_seconds: number | null;
    max_execution_duration_seconds: number | null;
    success_count_30d: number;
    failure_count_30d: number;
    timeout_count_30d: number;
};

export type CronJobRunOutcome = {
    success: boolean;
    durationMs: number;
    /** When true, counts as timeout (+ failure) for monitoring fields. */
    timedOut?: boolean;
};

/** Next fire time from a cron expression (UTC), or null if unparseable. */
export function computeNextRunAt(
    cronExpression: string,
    from: Date = new Date()
): Date | null {
    const pattern = cronExpression?.trim();
    if (!pattern) {
        return null;
    }
    try {
        const interval = parseExpression(pattern, {
            currentDate: from,
            tz: "UTC",
        });
        return interval.next().toDate();
    } catch {
        return null;
    }
}

export function buildCronJobRunUpdate(
    job: CronJobRunStatsRow,
    outcome: CronJobRunOutcome,
    now: Date = new Date()
): Prisma.CronJobUpdateInput {
    const durationSeconds = Math.max(
        0,
        Math.round(outcome.durationMs / 1000)
    );
    const priorRuns =
        (job.success_count_30d || 0) + (job.failure_count_30d || 0);
    const prevAvg = job.average_execution_duration_seconds;
    const average =
        priorRuns <= 0 || prevAvg == null
            ? durationSeconds
            : Math.round(
                  (prevAvg * priorRuns + durationSeconds) / (priorRuns + 1)
              );

    const timedOut =
        outcome.timedOut === true ||
        (!outcome.success &&
            durationSeconds >= (job.timeout_period_seconds || 1800));

    const data: Prisma.CronJobUpdateInput = {
        last_run_at: now,
        next_run_at: computeNextRunAt(job.cron_expression, now),
        last_execution_duration_seconds: durationSeconds,
        average_execution_duration_seconds: average,
        min_execution_duration_seconds:
            job.min_execution_duration_seconds == null
                ? durationSeconds
                : Math.min(job.min_execution_duration_seconds, durationSeconds),
        max_execution_duration_seconds:
            job.max_execution_duration_seconds == null
                ? durationSeconds
                : Math.max(job.max_execution_duration_seconds, durationSeconds),
    };

    if (timedOut) {
        data.timeout_count_30d = { increment: 1 };
        data.last_timeout_at = now;
        data.failure_count_30d = { increment: 1 };
        data.last_failure_at = now;
    } else if (outcome.success) {
        data.success_count_30d = { increment: 1 };
        data.last_success_at = now;
    } else {
        data.failure_count_30d = { increment: 1 };
        data.last_failure_at = now;
    }

    return data;
}

/**
 * Persist CronJob monitoring fields after a Nest worker run.
 * Replaces the old monolith cronManager bookkeeping that stopped after cutover.
 */
export async function recordCronJobRun(
    prisma: PrismaClient,
    job: CronJobRunStatsRow,
    outcome: CronJobRunOutcome
): Promise<void> {
    const data = buildCronJobRunUpdate(job, outcome);
    await prisma.cronJob.update({
        where: { id: job.id },
        data,
    });
}
