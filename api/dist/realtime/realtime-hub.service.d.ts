import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
export declare class RealtimeHubService implements OnModuleInit, OnModuleDestroy {
    private readonly config;
    private readonly logger;
    private publisher;
    private subscriber;
    private readonly notificationClients;
    private readonly controlCenterClients;
    constructor(config: ConfigService);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    addNotificationClient(client: SseClient): void;
    removeNotificationClient(clientId: string): void;
    addControlCenterClient(client: SseClient): void;
    removeControlCenterClient(clientId: string): void;
    publishNotificationUpdate(payload: NotificationRealtimePayload): Promise<void>;
    publishControlCenterUpdate(payload: ControlCenterRealtimePayload): Promise<void>;
    notifyNotificationChange(userId: string, reason: string, data?: Record<string, unknown>): Promise<void>;
    private publish;
    private onRedisMessage;
    private fanOutNotification;
    private fanOutControlCenter;
    private safeWrite;
}
export {};
