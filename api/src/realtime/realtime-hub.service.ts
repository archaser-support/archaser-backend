import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import IORedis from "ioredis";
import type { Response } from "express";

export type NotificationRealtimePayload = {
    type: "notification-update";
    data: Record<string, unknown>;
    timestamp: number;
    userId?: string;
    reason?: string;
};

export type ControlCenterRealtimePayload = {
    type: "control-center-update";
    data: Record<string, unknown>;
    timestamp: number;
    reason?: string;
    userId?: string;
    excludeFromNotifications?: boolean;
    source?: "manual" | "automated" | "user-action";
};

type SseClient = {
    id: string;
    userId: string;
    accountId: number | null;
    hasViewAsPermission: boolean;
    res: Response;
};

const NOTIFICATIONS_CHANNEL = "archaser:realtime:notifications";
const CONTROL_CENTER_CHANNEL = "archaser:realtime:control-center";

@Injectable()
export class RealtimeHubService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RealtimeHubService.name);
    private publisher: IORedis | null = null;
    private subscriber: IORedis | null = null;
    private readonly notificationClients = new Map<string, SseClient>();
    private readonly controlCenterClients = new Map<string, SseClient>();

    constructor(private readonly config: ConfigService) {}

    async onModuleInit(): Promise<void> {
        const redisUrl =
            this.config.get<string>("REDIS_URL") || "redis://127.0.0.1:6379";
        let publisher: IORedis | null = null;
        let subscriber: IORedis | null = null;
        try {
            const redisOptions = {
                maxRetriesPerRequest: 1,
                lazyConnect: true,
                enableOfflineQueue: false,
                // Stop reconnect spam when Redis is down (local `dev:api`).
                retryStrategy: (times: number) =>
                    times > 2 ? null : Math.min(times * 200, 1000),
            };
            publisher = new IORedis(redisUrl, redisOptions);
            subscriber = new IORedis(redisUrl, redisOptions);
            const onError = (err: Error) => {
                this.logger.warn(`Realtime Redis: ${err.message}`);
            };
            publisher.on("error", onError);
            subscriber.on("error", onError);

            await publisher.connect();
            await subscriber.connect();
            await subscriber.subscribe(
                NOTIFICATIONS_CHANNEL,
                CONTROL_CENTER_CHANNEL
            );
            subscriber.on("message", (channel, message) => {
                this.onRedisMessage(channel, message);
            });
            this.publisher = publisher;
            this.subscriber = subscriber;
        } catch (error) {
            this.logger.warn(
                `Realtime Redis unavailable — in-process fan-out only: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            await publisher?.quit().catch(() => undefined);
            await subscriber?.quit().catch(() => undefined);
            this.publisher = null;
            this.subscriber = null;
        }
    }

    async onModuleDestroy(): Promise<void> {
        await this.subscriber?.quit().catch(() => undefined);
        await this.publisher?.quit().catch(() => undefined);
    }

    addNotificationClient(client: SseClient): void {
        this.notificationClients.set(client.id, client);
    }

    removeNotificationClient(clientId: string): void {
        this.notificationClients.delete(clientId);
    }

    addControlCenterClient(client: SseClient): void {
        this.controlCenterClients.set(client.id, client);
    }

    removeControlCenterClient(clientId: string): void {
        this.controlCenterClients.delete(clientId);
    }

    async publishNotificationUpdate(
        payload: NotificationRealtimePayload
    ): Promise<void> {
        // Prefer Redis so all API instances fan out once via subscriber.
        if (this.publisher) {
            await this.publish(NOTIFICATIONS_CHANNEL, payload);
            return;
        }
        this.fanOutNotification(payload);
    }

    async publishControlCenterUpdate(
        payload: ControlCenterRealtimePayload
    ): Promise<void> {
        if (this.publisher) {
            await this.publish(CONTROL_CENTER_CHANNEL, payload);
            return;
        }
        this.fanOutControlCenter(payload);
    }

    /** Convenience for Nest notification mutations. */
    async notifyNotificationChange(
        userId: string,
        reason: string,
        data: Record<string, unknown> = {}
    ): Promise<void> {
        await this.publishNotificationUpdate({
            type: "notification-update",
            data,
            timestamp: Date.now(),
            userId,
            reason,
        });
    }

    private async publish(channel: string, payload: unknown): Promise<void> {
        if (!this.publisher) {
            return;
        }
        try {
            await this.publisher.publish(channel, JSON.stringify(payload));
        } catch (error) {
            this.logger.warn(
                `Redis publish failed (${channel}): ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    private onRedisMessage(channel: string, message: string): void {
        try {
            const payload = JSON.parse(message) as
                | NotificationRealtimePayload
                | ControlCenterRealtimePayload;
            if (channel === NOTIFICATIONS_CHANNEL) {
                this.fanOutNotification(
                    payload as NotificationRealtimePayload
                );
            } else if (channel === CONTROL_CENTER_CHANNEL) {
                this.fanOutControlCenter(
                    payload as ControlCenterRealtimePayload
                );
            }
        } catch (error) {
            this.logger.warn(
                `Bad realtime payload on ${channel}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    private fanOutNotification(update: NotificationRealtimePayload): void {
        const message = JSON.stringify(update);
        for (const client of this.notificationClients.values()) {
            const targeted = Boolean(update.userId && update.userId !== "");
            if (targeted && update.userId !== client.userId) {
                continue;
            }
            this.safeWrite(client, message, () =>
                this.removeNotificationClient(client.id)
            );
        }
    }

    private fanOutControlCenter(update: ControlCenterRealtimePayload): void {
        const message = JSON.stringify(update);
        for (const client of this.controlCenterClients.values()) {
            if (update.userId && update.userId !== client.userId) {
                continue;
            }
            if (
                update.excludeFromNotifications &&
                update.source === "automated" &&
                !client.hasViewAsPermission
            ) {
                continue;
            }
            if (
                update.source === "user-action" &&
                update.userId &&
                update.userId !== client.userId &&
                !client.hasViewAsPermission
            ) {
                continue;
            }
            this.safeWrite(client, message, () =>
                this.removeControlCenterClient(client.id)
            );
        }
    }

    private safeWrite(
        client: SseClient,
        data: string,
        onFail: () => void
    ): void {
        try {
            if (!client.res.writable || client.res.destroyed) {
                onFail();
                return;
            }
            client.res.write(`data: ${data}\n\n`);
        } catch {
            onFail();
        }
    }
}
