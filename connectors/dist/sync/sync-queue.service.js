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
var SyncQueueService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncQueueService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const billing_connector_1 = require("@archaser/billing-connector");
const database_service_1 = require("../database/database.service");
/**
 * Connectors-owned sync queue (D63–D65).
 * Disabled until path flip (D72) unless ENABLE_CONNECTORS_SYNC_WORKERS=true.
 */
let SyncQueueService = SyncQueueService_1 = class SyncQueueService {
    constructor(config, db) {
        this.config = config;
        this.db = db;
        this.logger = new common_1.Logger(SyncQueueService_1.name);
    }
    enabled() {
        return (this.config.get("ENABLE_CONNECTORS_SYNC_WORKERS") ===
            "true" ||
            process.env.ENABLE_CONNECTORS_SYNC_WORKERS === "true");
    }
    async onModuleInit() {
        if (!this.enabled()) {
            this.logger.log("Connectors sync workers disabled (D72). Set ENABLE_CONNECTORS_SYNC_WORKERS=true after path flip.");
            return;
        }
        const redisUrl = this.config.get("REDIS_URL") ||
            process.env.REDIS_URL ||
            "redis://127.0.0.1:6379";
        this.connection = new ioredis_1.default(redisUrl, { maxRetriesPerRequest: null });
        this.queue = new bullmq_1.Queue("billing-connector-sync", {
            connection: this.connection,
        });
        this.worker = new bullmq_1.Worker("billing-connector-sync", async (job) => {
            const accountId = Number(job.data.accountId);
            return (0, billing_connector_1.runInProcessSync)({
                prisma: this.db,
                accountId,
                trigger: String(job.data.trigger || "queue"),
                onLog: (message) => this.logger.log(`[account ${accountId}] ${message}`),
            });
        }, { connection: this.connection });
        this.logger.log("Connectors sync worker started");
    }
    async enqueue(accountId, trigger = "manual") {
        if (!this.enabled() || !this.queue) {
            return {
                enqueued: false,
                reason: "ENABLE_CONNECTORS_SYNC_WORKERS is not true",
                accountId,
            };
        }
        const job = await this.queue.add("sync", { accountId, trigger }, { removeOnComplete: 100, removeOnFail: 50 });
        return { enqueued: true, jobId: String(job.id), accountId };
    }
    async onModuleDestroy() {
        await this.worker?.close();
        await this.queue?.close();
        await this.connection?.quit();
    }
};
exports.SyncQueueService = SyncQueueService;
exports.SyncQueueService = SyncQueueService = SyncQueueService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        database_service_1.DatabaseService])
], SyncQueueService);
