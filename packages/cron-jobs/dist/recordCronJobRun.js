"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeNextRunAt = computeNextRunAt;
exports.buildCronJobRunUpdate = buildCronJobRunUpdate;
exports.recordCronJobRun = recordCronJobRun;
const cron_parser_1 = require("cron-parser");
/** Next fire time from a cron expression (UTC), or null if unparseable. */
function computeNextRunAt(cronExpression, from = new Date()) {
    const pattern = cronExpression?.trim();
    if (!pattern) {
        return null;
    }
    try {
        const interval = (0, cron_parser_1.parseExpression)(pattern, {
            currentDate: from,
            tz: "UTC",
        });
        return interval.next().toDate();
    }
    catch {
        return null;
    }
}
function buildCronJobRunUpdate(job, outcome, now = new Date()) {
    const durationSeconds = Math.max(0, Math.round(outcome.durationMs / 1000));
    const priorRuns = (job.success_count_30d || 0) + (job.failure_count_30d || 0);
    const prevAvg = job.average_execution_duration_seconds;
    const average = priorRuns <= 0 || prevAvg == null
        ? durationSeconds
        : Math.round((prevAvg * priorRuns + durationSeconds) / (priorRuns + 1));
    const timedOut = outcome.timedOut === true ||
        (!outcome.success &&
            durationSeconds >= (job.timeout_period_seconds || 1800));
    const data = {
        last_run_at: now,
        next_run_at: computeNextRunAt(job.cron_expression, now),
        last_execution_duration_seconds: durationSeconds,
        average_execution_duration_seconds: average,
        min_execution_duration_seconds: job.min_execution_duration_seconds == null
            ? durationSeconds
            : Math.min(job.min_execution_duration_seconds, durationSeconds),
        max_execution_duration_seconds: job.max_execution_duration_seconds == null
            ? durationSeconds
            : Math.max(job.max_execution_duration_seconds, durationSeconds),
    };
    if (timedOut) {
        data.timeout_count_30d = { increment: 1 };
        data.last_timeout_at = now;
        data.failure_count_30d = { increment: 1 };
        data.last_failure_at = now;
    }
    else if (outcome.success) {
        data.success_count_30d = { increment: 1 };
        data.last_success_at = now;
    }
    else {
        data.failure_count_30d = { increment: 1 };
        data.last_failure_at = now;
    }
    return data;
}
/**
 * Persist CronJob monitoring fields after a Nest worker run.
 * Replaces the old monolith cronManager bookkeeping that stopped after cutover.
 */
async function recordCronJobRun(prisma, job, outcome) {
    const data = buildCronJobRunUpdate(job, outcome);
    await prisma.cronJob.update({
        where: { id: job.id },
        data,
    });
}
