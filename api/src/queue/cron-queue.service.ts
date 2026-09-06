import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
    CRON_QUEUE_NAME,
    CronRunNowJobData,
    CronSyncSchedulesJobData,
    ArPostIngestDrainJobData,
} from "./cron-queue.types";

@Injectable()
export class CronQueueService implements OnModuleDestroy {
    private readonly logger = new Logger(CronQueueService.name);
    private connection: IORedis | null = null;
    private queue: Queue | null = null;

    constructor(private readonly config: ConfigService) {}

    private enabled(): boolean {
        return this.config.get("BULLMQ_ENABLED") !== "false";
    }

    private ensureQueue(): Queue | null {
        if (!this.enabled()) {
            return null;
        }
        if (this.queue) {
            return this.queue;
        }
        const redisUrl =
            this.config.get<string>("REDIS_URL") || "redis://127.0.0.1:6379";
        this.connection = new IORedis(redisUrl, {
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            enableOfflineQueue: false,
            retryStrategy: (times: number) =>
                times > 2 ? null : Math.min(times * 200, 1000),
        });
        this.connection.on("error", (err) => {
            this.logger.warn(`Cron queue Redis: ${err.message}`);
        });
        this.queue = new Queue(CRON_QUEUE_NAME, {
            connection: this.connection,
        });
        this.logger.log(`Cron queue ready (${CRON_QUEUE_NAME} @ ${redisUrl})`);
        return this.queue;
    }

    async enqueueRunNow(data: CronRunNowJobData): Promise<{
        queued: boolean;
        jobId?: string;
        reason?: string;
    }> {
        const queue = this.ensureQueue();
        if (!queue) {
            return {
                queued: false,
                reason: "BULLMQ_ENABLED=false or Redis unavailable",
            };
        }
        try {
            if (this.connection && this.connection.status !== "ready") {
                await this.connection.connect();
            }
            const job = await queue.add("run-now", data, {
                removeOnComplete: 100,
                removeOnFail: 200,
            });
            return { queued: true, jobId: String(job.id) };
        } catch (error) {
            this.logger.error(
                `enqueueRunNow failed: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return {
                queued: false,
                reason: error instanceof Error ? error.message : "enqueue failed",
            };
        }
    }

    async enqueueSyncSchedules(
        data: CronSyncSchedulesJobData
    ): Promise<{ queued: boolean; jobId?: string; reason?: string }> {
        const queue = this.ensureQueue();
        if (!queue) {
            return { queued: false, reason: "queue disabled" };
        }
        try {
            if (this.connection && this.connection.status !== "ready") {
                await this.connection.connect();
            }
            const job = await queue.add("sync-schedules", data, {
                removeOnComplete: 20,
                removeOnFail: 50,
            });
            return { queued: true, jobId: String(job.id) };
        } catch (error) {
            return {
                queued: false,
                reason: error instanceof Error ? error.message : "enqueue failed",
            };
        }
    }

    /**
     * Wait until Redis is ready. Avoids `connect()` while status is already
     * `connecting` (ioredis throws "Redis is already connecting/connected").
     */
    private async ensureRedisReady(): Promise<{
        ok: boolean;
        reason?: string;
    }> {
        if (!this.connection) {
            return { ok: false, reason: "Redis connection not initialized" };
        }
        const connection = this.connection;
        if (connection.status === "ready") {
            return { ok: true };
        }
        if (
            connection.status === "connecting" ||
            connection.status === "connect" ||
            connection.status === "reconnecting"
        ) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const onReady = () => {
                        cleanup();
                        resolve();
                    };
                    const onError = (err: Error) => {
                        cleanup();
                        reject(err);
                    };
                    const cleanup = () => {
                        connection.off("ready", onReady);
                        connection.off("error", onError);
                    };
                    connection.once("ready", onReady);
                    connection.once("error", onError);
                    if (connection.status === "ready") {
                        cleanup();
                        resolve();
                    }
                });
                return { ok: true };
            } catch (error) {
                return {
                    ok: false,
                    reason:
                        error instanceof Error
                            ? error.message
                            : "Redis connect wait failed",
                };
            }
        }
        try {
            await connection.connect();
            return { ok: true };
        } catch (error) {
            return {
                ok: false,
                reason:
                    error instanceof Error
                        ? error.message
                        : "Redis connect failed",
            };
        }
    }

    async enqueueArPostIngestDrain(
        data: ArPostIngestDrainJobData = {}
    ): Promise<{ queued: boolean; jobId?: string; reason?: string }> {
        const queue = this.ensureQueue();
        if (!queue) {
            return {
                queued: false,
                reason: "BULLMQ_ENABLED=false or Redis unavailable",
            };
        }
        const ready = await this.ensureRedisReady();
        if (!ready.ok) {
            this.logger.error(
                `enqueueArPostIngestDrain failed: ${ready.reason ?? "Redis not ready"}`
            );
            return {
                queued: false,
                reason: ready.reason ?? "Redis not ready",
            };
        }
        try {
            const job = await queue.add("ar-post-ingest-drain", data, {
                removeOnComplete: 100,
                removeOnFail: 200,
            });
            return { queued: true, jobId: String(job.id) };
        } catch (error) {
            this.logger.error(
                `enqueueArPostIngestDrain failed: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return {
                queued: false,
                reason: error instanceof Error ? error.message : "enqueue failed",
            };
        }
    }

    async onModuleDestroy() {
        await this.queue?.close();
        await this.connection?.quit();
    }
}
