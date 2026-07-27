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
var RealtimeHubService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeHubService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ioredis_1 = __importDefault(require("ioredis"));
const NOTIFICATIONS_CHANNEL = "archaser:realtime:notifications";
const CONTROL_CENTER_CHANNEL = "archaser:realtime:control-center";
let RealtimeHubService = RealtimeHubService_1 = class RealtimeHubService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(RealtimeHubService_1.name);
        this.publisher = null;
        this.subscriber = null;
        this.notificationClients = new Map();
        this.controlCenterClients = new Map();
    }
    async onModuleInit() {
        const redisUrl = this.config.get("REDIS_URL") || "redis://127.0.0.1:6379";
        try {
            this.publisher = new ioredis_1.default(redisUrl, {
                maxRetriesPerRequest: null,
                lazyConnect: true,
            });
            this.subscriber = new ioredis_1.default(redisUrl, {
                maxRetriesPerRequest: null,
                lazyConnect: true,
            });
            await this.publisher.connect();
            await this.subscriber.connect();
            await this.subscriber.subscribe(NOTIFICATIONS_CHANNEL, CONTROL_CENTER_CHANNEL);
            this.subscriber.on("message", (channel, message) => {
                this.onRedisMessage(channel, message);
            });
            this.logger.log(`Realtime Redis pub/sub ready @ ${redisUrl}`);
        }
        catch (error) {
            this.logger.warn(`Realtime Redis unavailable — in-process fan-out only: ${error instanceof Error ? error.message : String(error)}`);
            this.publisher = null;
            this.subscriber = null;
        }
    }
    async onModuleDestroy() {
        await this.subscriber?.quit().catch(() => undefined);
        await this.publisher?.quit().catch(() => undefined);
    }
    addNotificationClient(client) {
        this.notificationClients.set(client.id, client);
    }
    removeNotificationClient(clientId) {
        this.notificationClients.delete(clientId);
    }
    addControlCenterClient(client) {
        this.controlCenterClients.set(client.id, client);
    }
    removeControlCenterClient(clientId) {
        this.controlCenterClients.delete(clientId);
    }
    async publishNotificationUpdate(payload) {
        if (this.publisher) {
            await this.publish(NOTIFICATIONS_CHANNEL, payload);
            return;
        }
        this.fanOutNotification(payload);
    }
    async publishControlCenterUpdate(payload) {
        if (this.publisher) {
            await this.publish(CONTROL_CENTER_CHANNEL, payload);
            return;
        }
        this.fanOutControlCenter(payload);
    }
    async notifyNotificationChange(userId, reason, data = {}) {
        await this.publishNotificationUpdate({
            type: "notification-update",
            data,
            timestamp: Date.now(),
            userId,
            reason,
        });
    }
    async publish(channel, payload) {
        if (!this.publisher) {
            return;
        }
        try {
            await this.publisher.publish(channel, JSON.stringify(payload));
        }
        catch (error) {
            this.logger.warn(`Redis publish failed (${channel}): ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    onRedisMessage(channel, message) {
        try {
            const payload = JSON.parse(message);
            if (channel === NOTIFICATIONS_CHANNEL) {
                this.fanOutNotification(payload);
            }
            else if (channel === CONTROL_CENTER_CHANNEL) {
                this.fanOutControlCenter(payload);
            }
        }
        catch (error) {
            this.logger.warn(`Bad realtime payload on ${channel}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    fanOutNotification(update) {
        const message = JSON.stringify(update);
        for (const client of this.notificationClients.values()) {
            const targeted = Boolean(update.userId && update.userId !== "");
            if (targeted && update.userId !== client.userId) {
                continue;
            }
            this.safeWrite(client, message, () => this.removeNotificationClient(client.id));
        }
    }
    fanOutControlCenter(update) {
        const message = JSON.stringify(update);
        for (const client of this.controlCenterClients.values()) {
            if (update.userId && update.userId !== client.userId) {
                continue;
            }
            if (update.excludeFromNotifications &&
                update.source === "automated" &&
                !client.hasViewAsPermission) {
                continue;
            }
            if (update.source === "user-action" &&
                update.userId &&
                update.userId !== client.userId &&
                !client.hasViewAsPermission) {
                continue;
            }
            this.safeWrite(client, message, () => this.removeControlCenterClient(client.id));
        }
    }
    safeWrite(client, data, onFail) {
        try {
            if (!client.res.writable || client.res.destroyed) {
                onFail();
                return;
            }
            client.res.write(`data: ${data}\n\n`);
        }
        catch {
            onFail();
        }
    }
};
exports.RealtimeHubService = RealtimeHubService;
exports.RealtimeHubService = RealtimeHubService = RealtimeHubService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RealtimeHubService);
//# sourceMappingURL=realtime-hub.service.js.map