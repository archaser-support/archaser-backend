"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var WorkerRuntimeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const prom_client_1 = require("prom-client");
const database_1 = require("@archaser/database");
const cron_jobs_1 = require("@archaser/cron-jobs");
const billing_connector_1 = require("@archaser/billing-connector");
const billing_connector_sync_counters_1 = require("./billing-connector-sync-counters");
const QUEUE_NAME = process.env.BULLMQ_QUEUE || "archaser-cron";
const cronJobExecutionsTotal = new prom_client_1.Counter({
    name: "archaser_cron_job_executions_total",
    help: "Total cron job executions",
    labelNames: ["job_name", "status"],
    registers: [],
});
const cronJobDurationSeconds = new prom_client_1.Gauge({
    name: "archaser_cron_job_duration_seconds",
    help: "Last execution duration of cron jobs in seconds",
    labelNames: ["job_name"],
    registers: [],
});
let WorkerRuntimeService = WorkerRuntimeService_1 = class WorkerRuntimeService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(WorkerRuntimeService_1.name);
        this.connection = null;
        this.worker = null;
        this.queue = null;
        this.prisma = null;
        this.register = new prom_client_1.Registry();
    }
    async start() {
        this.register.setDefaultLabels({ service: "archaser-worker" });
        this.register.registerMetric(cronJobExecutionsTotal);
        this.register.registerMetric(cronJobDurationSeconds);
        const billingCounters = (0, billing_connector_sync_counters_1.registerBillingConnectorSyncCounters)(this.register);
        (0, billing_connector_1.setDefaultBillingConnectorMetricsSink)((0, billing_connector_1.createBillingConnectorMetricsSinkFromProm)({
            syncTotal: billingCounters.billingConnectorSyncTotal,
            syncDuration: billingCounters.billingConnectorSyncDuration,
            errorsTotal: billingCounters.billingConnectorErrorsTotal,
            recordsProcessed: billingCounters.billingConnectorRecordsProcessed,
        }));
        (0, billing_connector_1.registerArPostIngestOrchestrator)((options) => (0, cron_jobs_1.runArPostIngestForCustomers)(options));
        (0, prom_client_1.collectDefaultMetrics)({
            register: this.register,
            prefix: "archaser_worker_",
        });
        const redisUrl = this.config.get("REDIS_URL") || "redis://127.0.0.1:6379";
        this.connection = new ioredis_1.default(redisUrl, {
            maxRetriesPerRequest: null,
        });
        this.queue = new bullmq_1.Queue(QUEUE_NAME, { connection: this.connection });
        try {
            this.prisma = (0, database_1.createPrismaClient)({
                module: "worker",
                applicationName: "archaser-worker",
                connectionLimit: Number(process.env.CONNECTION_LIMIT_WORKER || 5),
            });
        }
        catch (error) {
            this.logger.warn(`Prisma not available yet: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.worker = new bullmq_1.Worker(QUEUE_NAME, async (job) => this.handleJob(job), { connection: this.connection });
        this.worker.on("failed", (job, err) => {
            this.logger.error(`Job ${job?.id} failed: ${err.message}`);
        });
        await this.syncRepeatables("startup");
        this.logger.log(`Worker listening on queue=${QUEUE_NAME} redis=${redisUrl}`);
    }
    async handleJob(job) {
        this.logger.log(`Processing ${job.name} id=${job.id} data=${JSON.stringify(job.data)}`);
        if (job.name === "sync-schedules") {
            await this.syncRepeatables("config-change");
            return { ok: true, synced: true };
        }
        if (job.name === "run-now") {
            const data = job.data;
            return this.executeCronJob(data.cronJobId, "run-now");
        }
        if (job.name === "ar-post-ingest-drain") {
            const data = job.data;
            const result = await (0, cron_jobs_1.drainArPostIngestRetryQueue)({
                maxItems: data.maxItems ?? 100,
            });
            this.logger.log(`AR post-ingest drain: ${result.itemsProcessed} processed, ${result.failures} failures, ${result.givenUp} given up`);
            return result;
        }
        if (job.name.startsWith("cron:")) {
            const cronJobId = Number(job.name.replace("cron:", ""));
            return this.executeCronJob(cronJobId, "schedule");
        }
        return { ok: true, ignored: true };
    }
    async executeCronJob(cronJobId, source) {
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
        this.logger.log(`Executing CronJob ${job.id} (${job.name}) via ${source}`);
        const started = Date.now();
        let result;
        try {
            result = await (0, cron_jobs_1.executeNamedCronJob)(this.prisma, job.name, {
                lastRunAt: job.last_run_at,
            });
        }
        catch (error) {
            const durationMs = typeof error === "object" &&
                error !== null &&
                "durationMs" in error &&
                typeof error.durationMs ===
                    "number"
                ? error.durationMs
                : Date.now() - started;
            result = {
                success: false,
                message: error instanceof Error
                    ? error.message
                    : `CronJob ${job.name} failed`,
                durationMs,
            };
            this.logger.error(`CronJob ${job.id} (${job.name}) failed: ${result.message}`);
        }
        try {
            await (0, cron_jobs_1.recordCronJobRun)(this.prisma, job, {
                success: result.success,
                durationMs: result.durationMs,
            });
        }
        catch (error) {
            this.logger.warn(`Failed to persist CronJob ${job.id} run stats: ${error instanceof Error ? error.message : String(error)}`);
        }
        const timedOut = !result.success &&
            Math.round((result.durationMs || 0) / 1000) >=
                (job.timeout_period_seconds || 1800);
        const status = timedOut
            ? "TIMEOUT"
            : result.success
                ? "SUCCESS"
                : "FAILED";
        const durationSeconds = Math.max(0, Math.round((result.durationMs || 0) / 1000));
        try {
            cronJobExecutionsTotal.inc({ job_name: job.name, status });
            cronJobDurationSeconds.set({ job_name: job.name }, durationSeconds);
        }
        catch (error) {
            this.logger.warn(`Failed to record Prometheus metrics for CronJob ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return {
            ok: result.success,
            cronJobId: job.id,
            name: job.name,
            source,
            ...result,
        };
    }
    async syncRepeatables(reason) {
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
                await this.queue.add(jobId, { cronJobId: job.id }, {
                    jobId,
                    repeat: { pattern },
                    removeOnComplete: 50,
                    removeOnFail: 50,
                });
                const nextRunAt = (0, cron_jobs_1.computeNextRunAt)(pattern);
                if (nextRunAt) {
                    await this.prisma.cronJob.update({
                        where: { id: job.id },
                        data: { next_run_at: nextRunAt },
                    });
                }
                synced += 1;
            }
            catch (error) {
                this.logger.warn(`Skip repeatable for CronJob ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.logger.log(`Synced ${synced} repeatables (${reason})`);
        return { synced, reason };
    }
    async metrics() {
        return this.register.metrics();
    }
    async onModuleDestroy() {
        await this.worker?.close();
        await this.queue?.close();
        await this.connection?.quit();
        await this.prisma?.$disconnect();
    }
};
WorkerRuntimeService = WorkerRuntimeService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], WorkerRuntimeService);
let WorkerController = class WorkerController {
    constructor(runtime) {
        this.runtime = runtime;
    }
    health() {
        return { status: "ok", service: "archaser-worker" };
    }
    async metrics(res) {
        res.send(await this.runtime.metrics());
    }
};
__decorate([
    (0, common_1.Get)("health"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WorkerController.prototype, "health", null);
__decorate([
    (0, common_1.Get)("metrics"),
    (0, common_1.Header)("Content-Type", "text/plain; version=0.0.4; charset=utf-8"),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WorkerController.prototype, "metrics", null);
WorkerController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [WorkerRuntimeService])
], WorkerController);
let WorkerModule = class WorkerModule {
};
WorkerModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: [".env", "../.env"],
            }),
        ],
        controllers: [WorkerController],
        providers: [WorkerRuntimeService],
    })
], WorkerModule);
async function bootstrap() {
    const app = await core_1.NestFactory.create(WorkerModule);
    const runtime = app.get(WorkerRuntimeService);
    await runtime.start();
    const port = Number(process.env.WORKER_PORT || 3003);
    await app.listen(port);
    if (typeof process.send === "function") {
        process.send("ready");
    }
}
bootstrap();
//# sourceMappingURL=main.js.map