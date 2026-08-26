import type { Prisma, PrismaClient } from "@prisma/client";
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
export declare function computeNextRunAt(cronExpression: string, from?: Date): Date | null;
export declare function buildCronJobRunUpdate(job: CronJobRunStatsRow, outcome: CronJobRunOutcome, now?: Date): Prisma.CronJobUpdateInput;
/**
 * Persist CronJob monitoring fields after a Nest worker run.
 * Replaces the old monolith cronManager bookkeeping that stopped after cutover.
 */
export declare function recordCronJobRun(prisma: PrismaClient, job: CronJobRunStatsRow, outcome: CronJobRunOutcome): Promise<void>;
