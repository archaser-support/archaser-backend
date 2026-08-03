import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { runInProcessSync } from "@archaser/billing-connector";
import { DatabaseService } from "../database/database.service";

/**
 * Connectors-owned sync queue (D63–D65).
 * Disabled until path flip (D72) unless ENABLE_CONNECTORS_SYNC_WORKERS=true.
 */
@Injectable()
export class SyncQueueService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(SyncQueueService.name);
    private connection?: IORedis;
    private queue?: Queue;
    private worker?: Worker;

    constructor(
        private readonly config: ConfigService,
        private readonly db: DatabaseService
    ) {}

    private enabled(): boolean {
        return (
            this.config.get<string>("ENABLE_CONNECTORS_SYNC_WORKERS") ===
                "true" ||
            process.env.ENABLE_CONNECTORS_SYNC_WORKERS === "true"
        );
    }

    async onModuleInit() {
        if (!this.enabled()) {
            this.logger.log(
                "Connectors sync workers disabled (D72). Set ENABLE_CONNECTORS_SYNC_WORKERS=true after path flip."
            );
            return;
        }
        const redisUrl =
            this.config.get<string>("REDIS_URL") ||
            process.env.REDIS_URL ||
            "redis://127.0.0.1:6379";
        this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
        this.queue = new Queue("billing-connector-sync", {
            connection: this.connection,
        });
        this.worker = new Worker(
            "billing-connector-sync",
            async (job) => {
                const accountId = Number(job.data.accountId);
                return runInProcessSync({
                    prisma: this.db,
                    accountId,
                    trigger: String(job.data.trigger || "queue"),
                });
            },
            { connection: this.connection }
        );
        this.logger.log("Connectors sync worker started");
    }

    async enqueue(accountId: number, trigger = "manual") {
        if (!this.enabled() || !this.queue) {
            return {
                enqueued: false,
                reason: "ENABLE_CONNECTORS_SYNC_WORKERS is not true",
                accountId,
            };
        }
        const job = await this.queue.add(
            "sync",
            { accountId, trigger },
            { removeOnComplete: 100, removeOnFail: 50 }
        );
        return { enqueued: true, jobId: String(job.id), accountId };
    }

    async onModuleDestroy() {
        await this.worker?.close();
        await this.queue?.close();
        await this.connection?.quit();
    }
}
