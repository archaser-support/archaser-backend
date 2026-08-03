import { SyncQueueService } from "../sync/sync-queue.service";
import { DatabaseService } from "../database/database.service";
export declare class InternalConnectorsController {
    private readonly syncQueue;
    private readonly db;
    constructor(syncQueue: SyncQueueService, db: DatabaseService);
    sync(accountId: number, body: Record<string, unknown>): Promise<import("@archaser/billing-connector").RunInProcessSyncResult | {
        enqueued: boolean;
        reason: string;
        accountId: number;
        jobId?: undefined;
    } | {
        enqueued: boolean;
        jobId: string;
        accountId: number;
        reason?: undefined;
    }>;
}
