import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
    Module,
    Controller,
    Get,
    Header,
    Injectable,
    Logger,
    OnModuleDestroy,
    Res,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { collectDefaultMetrics, Counter, Gauge, Registry } from "prom-client";
import {
    createPrismaClient,
    PrismaClient,
} from "@archaser/database";
import type { Response } from "express";
import {
    computeNextRunAt,
    drainArPostIngestRetryQueue,
    executeNamedCronJob,
    recordCronJobRun,
    runArPostIngestForCustomers,
    type CronJobResult,
} from "@archaser/cron-jobs";
import {
    createBillingConnectorMetricsSinkFromProm,
    registerArPostIngestOrchestrator,
    setDefaultBillingConnectorMetricsSink,
} from "@archaser/billing-connector";
import { registerBillingConnectorSyncCounters } from "./billing-connector-sync-counters";

const QUEUE_NAME = process.env.BULLMQ_QUEUE || "archaser-cron";

/** Same names as API business metrics so Grafana `{instance="Staging"}` scrapes worker runs. */
const cronJobExecutionsTotal = new Counter({
    name: "archaser_cron_job_executions_total",
    help: "Total cron job executions",
    labelNames: ["job_name", "status"],
    registers: [],
});

const cronJobDurationSeconds = new Gauge({
    name: "archaser_cron_job_duration_seconds",
    help: "Last execution duration of cron jobs in seconds",
    labelNames: ["job_name"],
    registers: [],
});


type RunNowData = {
    cronJobId: number;
    triggeredBy?: string;
    accountId?: number | null;
};

@Injectable()
class WorkerRuntimeService implements OnModuleDestroy {
    private readonly logger = new Logger(WorkerRuntimeService.name);
    private connection: IORedis | null = null;
    private worker: Worker | null = null;
    private queue: Queue | null = null;
    private prisma: PrismaClient | null = null;
    readonly register = new Registry();

    constructor(private readonly config: ConfigService) {}

    async start(): Promise<void> {
        this.register.setDefaultLabels({ service: "archaser-worker" });
        this.register.registerMetric(cronJobExecutionsTotal);
        this.register.registerMetric(cronJobDurationSeconds);
        const billingCounters = registerBillingConnectorSyncCounters(
            this.register
        );
        setDefaultBillingConnectorMetricsSink(
            createBillingConnectorMetricsSinkFromProm({
                syncTotal: billingCounters.billingConnectorSyncTotal,
                syncDuration: billingCounters.billingConnectorSyncDuration,
                errorsTotal: billingCounters.billingConnectorErrorsTotal,
                recordsProcessed:
                    billingCounters.billingConnectorRecordsProcessed,
            })
        );
        // `syncDueBillingConnectors` (billing sync dispatch cron) reaches
        // billing-connector's no-callback fallback, which calls the registered
        // orchestrator. Without this it would log "orchestrator is not
        // registered" and post-ingest AR refresh would stop in this process.
        registerArPostIngestOrchestrator((options) =>
            runArPostIngestForCustomers(options)
        );
        collectDefaultMetrics({
            register: this.register,
            prefix: "archaser_worker_",
        });

        const redisUrl =
            this.config.get<string>("REDIS_URL") || "redis://127.0.0.1:6379";
        this.connection = new IORedis(redisUrl, {
            maxRetriesPerRequest: null,
        });
        this.queue = new Queue(QUEUE_NAME, { connection: this.connection });

        try {
            this.prisma = createPrismaClient({
                module: "worker",
                applicationName: "archaser-worker",
                connectionLimit: Number(
                    process.env.CONNECTION_LIMIT_WORKER || 5
                ),
            });
        } catch (error) {
            this.logger.warn(
                `Prisma not available yet: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        this.worker = new Worker(
            QUEUE_NAME,
            async (job) => this.handleJob(job),
            { connection: this.connection }
        );

        this.worker.on("failed", (job, err) => {
            this.logger.error(`Job ${job?.id} failed: ${err.message}`);
        });

        await this.syncRepeatables("startup");

        this.logger.log(
            `Worker listening on queue=${QUEUE_NAME} redis=${redisUrl}`
        );
    }

    private async handleJob(job: Job): Promise<unknown> {
        this.logger.log(
            `Processing ${job.name} id=${job.id} data=${JSON.stringify(job.data)}`
        );

        if (job.name === "sync-schedules") {
            await this.syncRepeatables("config-change");
            return { ok: true, synced: true };
        }

        if (job.name === "run-now") {
            const data = job.data as RunNowData;
            return this.executeCronJob(data.cronJobId, "run-now");
        }

        if (job.name === "ar-post-ingest-drain") {
            const data = job.data as { maxItems?: number };
            const result = await drainArPostIngestRetryQueue({
                maxItems: data.maxItems ?? 100,
            });
            this.logger.log(
                `AR post-ingest drain: ${result.itemsProcessed} processed, ${result.failures} failures, ${result.givenUp} given up`
            );
            return result;
        }

        if (job.name.startsWith("cron:")) {
            const cronJobId = Number(job.name.replace("cron:", ""));
            return this.executeCronJob(cronJobId, "schedule");
        }

        return { ok: true, ignored: true };
    }

    private async executeCronJob(
        cronJobId: number,
        source: "run-now" | "schedule"
    ): Promise<unknown> {
        if (!this.prisma) {
            return { ok: false, reason: "database unavailable", cronJobId };
        }
        const job = await this.prisma.cronJob.findUnique({
            where: { id: cronJobId },
            select: {
                id: true,
                name: true,
                cron_expression: true,
                active: true,
                last_run_at: true,
                timeout_period_seconds: true,
                last_execution_duration_seconds: true,
                average_execution_duration_seconds: true,
                min_execution_duration_seconds: true,
                max_execution_duration_seconds: true,
                success_count_30d: true,
                failure_count_30d: true,
                timeout_count_30d: true,
            },
        });
        if (!job) {
            return { ok: false, reason: "CronJob not found", cronJobId };
        }

        this.logger.log(
            `Executing CronJob ${job.id} (${job.name}) via ${source}`
        );

        const started = Date.now();
        let result: CronJobResult;
        try {
            result = await executeNamedCronJob(this.prisma, job.name, {
                lastRunAt: job.last_run_at,
            });
        } catch (error: unknown) {
            const durationMs =
                typeof error === "object" &&
                error !== null &&
                "durationMs" in error &&
                typeof (error as { durationMs: unknown }).durationMs ===
                    "number"
                    ? (error as { durationMs: number }).durationMs
                    : Date.now() - started;
            result = {
                success: false,
                message:
                    error instanceof Error
                        ? error.message
                        : `CronJob ${job.name} failed`,
                durationMs,
            };
            this.logger.error(
                `CronJob ${job.id} (${job.name}) failed: ${result.message}`
            );
        }

        try {
            await recordCronJobRun(this.prisma, job, {
                success: result.success,
                durationMs: result.durationMs,
            });
        } catch (error: unknown) {
            this.logger.warn(
                `Failed to persist CronJob ${job.id} run stats: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        const timedOut =
            !result.success &&
            Math.round((result.durationMs || 0) / 1000) >=
                (job.timeout_period_seconds || 1800);
        const status = timedOut
            ? "TIMEOUT"
            : result.success
              ? "SUCCESS"
              : "FAILED";
        const durationSeconds = Math.max(
            0,
            Math.round((result.durationMs || 0) / 1000)
        );
        try {
            cronJobExecutionsTotal.inc({ job_name: job.name, status });
            cronJobDurationSeconds.set({ job_name: job.name }, durationSeconds);
        } catch (error: unknown) {
            this.logger.warn(
                `Failed to record Prometheus metrics for CronJob ${job.id}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        return {
            ok: result.success,
            cronJobId: job.id,
            name: job.name,
            source,
            ...result,
        };
    }

    /**
     * Sync BullMQ repeatables from enabled CronJob rows.
     * Requires cron-parser-compatible expressions in CronJob.cron_expression when present.
     */
    async syncRepeatables(
        reason: string
    ): Promise<{ synced: number; reason: string }> {
        if (!this.prisma || !this.queue) {
            return { synced: 0, reason };
        }
        const jobs = await this.prisma.cronJob.findMany({
            select: {
                id: true,
                name: true,
                cron_expression: true,
            },
        });

        let synced = 0;
        for (const job of jobs) {
            const pattern = job.cron_expression?.trim();
            if (!pattern) {
                continue;
            }
            const jobId = `cron:${job.id}`;
            try {
                await this.queue.add(
                    jobId,
                    { cronJobId: job.id },
                    {
                        jobId,
                        repeat: { pattern },
                        removeOnComplete: 50,
                        removeOnFail: 50,
                    }
                );
                const nextRunAt = computeNextRunAt(pattern);
                if (nextRunAt) {
                    await this.prisma.cronJob.update({
                        where: { id: job.id },
                        data: { next_run_at: nextRunAt },
                    });
                }
                synced += 1;
            } catch (error) {
                this.logger.warn(
                    `Skip repeatable for CronJob ${job.id}: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }
        this.logger.log(`Synced ${synced} repeatables (${reason})`);
        return { synced, reason };
    }

    async metrics(): Promise<string> {
        return this.register.metrics();
    }

    async onModuleDestroy() {
        await this.worker?.close();
        await this.queue?.close();
        await this.connection?.quit();
        await this.prisma?.$disconnect();
    }
}

@Controller()
class WorkerController {
    constructor(private readonly runtime: WorkerRuntimeService) {}

    @Get("health")
    health() {
        return { status: "ok", service: "archaser-worker" };
    }

    @Get("metrics")
    @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
    async metrics(@Res() res: Response) {
        res.send(await this.runtime.metrics());
    }
}

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [".env", "../.env"],
        }),
    ],
    controllers: [WorkerController],
    providers: [WorkerRuntimeService],
})
class WorkerModule {}

async function bootstrap() {
    const app = await NestFactory.create(WorkerModule);
    const runtime = app.get(WorkerRuntimeService);
    await runtime.start();
    const port = Number(process.env.WORKER_PORT || 3003);
    await app.listen(port);
    if (typeof process.send === "function") {
        process.send("ready");
    }
}

bootstrap();
