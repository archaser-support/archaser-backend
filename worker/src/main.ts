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
import { collectDefaultMetrics, Registry } from "prom-client";
import {
    createPrismaClient,
    PrismaClient,
} from "@archaser/database";
import type { Response } from "express";

const QUEUE_NAME = process.env.BULLMQ_QUEUE || "archaser-cron";

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
            },
        });
        if (!job) {
            return { ok: false, reason: "CronJob not found", cronJobId };
        }

        // Domain handlers plug in here (collection automation, connectors, etc.)
        this.logger.log(
            `Executed CronJob ${job.id} (${job.name}) via ${source}`
        );
        return {
            ok: true,
            cronJobId: job.id,
            name: job.name,
            source,
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
