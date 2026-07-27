import { DualAuthRequest } from "../auth/dual-auth.guard";
import { CronQueueService } from "./cron-queue.service";
export declare class CronQueueController {
    private readonly cronQueue;
    constructor(cronQueue: CronQueueService);
    syncSchedules(req: DualAuthRequest): Promise<{
        queued: boolean;
        jobId?: string;
        reason?: string;
        triggeredBy: string | undefined;
    }>;
    runNow(jobId: number, req: DualAuthRequest): Promise<{
        queued: boolean;
        jobId?: string;
        reason?: string;
        cronJobId: number;
    }>;
}
