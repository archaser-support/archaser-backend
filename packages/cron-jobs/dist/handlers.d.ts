import type { PrismaClient } from "@prisma/client";
export type CronJobResult = {
    success: boolean;
    message: string;
    stub?: boolean;
    reason?: string;
    summary?: unknown;
    durationMs: number;
};
export type CronJobContext = {
    lastRunAt?: Date | null;
};
/** CronJob names still owned by the Next cron path / pending Nest port. */
export declare const NOT_PORTED_CRON_JOB_NAMES: readonly [];
export declare function executeNamedCronJob(prisma: PrismaClient, name: string, ctx?: CronJobContext): Promise<CronJobResult>;
export declare function isCronJobPorted(name: string): boolean;
