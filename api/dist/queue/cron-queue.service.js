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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var CronQueueService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronQueueService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const cron_queue_types_1 = require("./cron-queue.types");
let CronQueueService = CronQueueService_1 = class CronQueueService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(CronQueueService_1.name);
        this.connection = null;
        this.queue = null;
    }
    enabled() {
        return this.config.get("BULLMQ_ENABLED") !== "false";
    }
    ensureQueue() {
        if (!this.enabled()) {
            return null;
        }
        if (this.queue) {
            return this.queue;
        }
        const redisUrl = this.config.get("REDIS_URL") || "redis://127.0.0.1:6379";
        this.connection = new ioredis_1.default(redisUrl, {
            maxRetriesPerRequest: null,
            lazyConnect: true,
        });
        this.queue = new bullmq_1.Queue(cron_queue_types_1.CRON_QUEUE_NAME, {
            connection: this.connection,
        });
        this.logger.log(`Cron queue ready (${cron_queue_types_1.CRON_QUEUE_NAME} @ ${redisUrl})`);
        return this.queue;
    }
    async enqueueRunNow(data) {
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
        }
        catch (error) {
            this.logger.error(`enqueueRunNow failed: ${error instanceof Error ? error.message : String(error)}`);
            return {
                queued: false,
                reason: error instanceof Error ? error.message : "enqueue failed",
            };
        }
    }
    async enqueueSyncSchedules(data) {
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
        }
        catch (error) {
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
};
exports.CronQueueService = CronQueueService;
exports.CronQueueService = CronQueueService = CronQueueService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], CronQueueService);
//# sourceMappingURL=cron-queue.service.js.map