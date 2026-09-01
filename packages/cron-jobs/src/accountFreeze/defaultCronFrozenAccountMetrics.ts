import type { CronFrozenAccountMetrics } from "./frozenAccountMetrics";

let defaultMetrics: CronFrozenAccountMetrics | null = null;

/** Worker/API register a process-wide sink when cron handlers lack DI. */
export function setDefaultCronFrozenAccountMetrics(
    metrics: CronFrozenAccountMetrics | null
): void {
    defaultMetrics = metrics;
}

export function getDefaultCronFrozenAccountMetrics(): CronFrozenAccountMetrics | null {
    return defaultMetrics;
}
