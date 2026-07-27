import { OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CronRunNowJobData, CronSyncSchedulesJobData } from "./cron-queue.types";
export declare class CronQueueService implements OnModuleDestroy {
    private readonly config;
    private readonly logger;
    private connection;
    private queue;
    constructor(config: ConfigService);
    private enabled;
    private ensureQueue;
    enqueueRunNow(data: CronRunNowJobData): Promise<{
        queued: boolean;
        jobId?: string;
        reason?: string;
    }>;
    enqueueSyncSchedules(data: CronSyncSchedulesJobData): Promise<{
        queued: boolean;
        jobId?: string;
        reason?: string;
    }>;
    onModuleDestroy(): Promise<void>;
}
