/**
 * Best-effort Control Center realtime fan-out via Redis pub/sub.
 * Payload shape matches api/src/realtime/realtime-hub.service.ts ControlCenterRealtimePayload.
 */

export type ControlCenterRealtimePayload = {
    type: "control-center-update";
    data: Record<string, unknown>;
    timestamp: number;
    reason?: string;
    userId?: string;
    excludeFromNotifications?: boolean;
    source?: "manual" | "automated" | "user-action";
};

const CONTROL_CENTER_CHANNEL = "archaser:realtime:control-center";

let warnedMissingRedis = false;

export async function publishControlCenterUpdate(
    reason: string,
    options?: {
        excludeFromNotifications?: boolean;
        source?: ControlCenterRealtimePayload["source"];
        data?: Record<string, unknown>;
    }
): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        if (!warnedMissingRedis) {
            warnedMissingRedis = true;
        }
        return;
    }

    const payload: ControlCenterRealtimePayload = {
        type: "control-center-update",
        data: options?.data ?? {},
        timestamp: Date.now(),
        reason,
        excludeFromNotifications: options?.excludeFromNotifications ?? true,
        source: options?.source ?? "automated",
    };

    let redis: { publish: (ch: string, msg: string) => Promise<number>; quit: () => Promise<string> } | null =
        null;

    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const IORedis = require("ioredis") as new (
            url: string,
            opts?: Record<string, unknown>
        ) => {
            publish: (channel: string, message: string) => Promise<number>;
            quit: () => Promise<string>;
        };

        redis = new IORedis(redisUrl, {
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            enableOfflineQueue: false,
            retryStrategy: (times: number) =>
                times > 2 ? null : Math.min(times * 200, 1000),
        });

        await redis.publish(CONTROL_CENTER_CHANNEL, JSON.stringify(payload));
    } catch {
        // Best-effort — do not throw
    } finally {
        if (redis) {
            try {
                await redis.quit();
            } catch {
                // ignore disconnect errors
            }
        }
    }
}
