import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
/**
 * Connectors-owned sync queue (D63–D65).
 * Disabled until path flip (D72) unless ENABLE_CONNECTORS_SYNC_WORKERS=true.
 */
export declare class SyncQueueService implements OnModuleInit, OnModuleDestroy {
    private readonly config;
    private readonly db;
    private readonly logger;
    private connection?;
    private queue?;
    private worker?;
    constructor(config: ConfigService, db: DatabaseService);
    private enabled;
    onModuleInit(): Promise<void>;
    enqueue(accountId: number, trigger?: string): Promise<{
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
    onModuleDestroy(): Promise<void>;
}
