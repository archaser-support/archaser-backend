"use strict";
/**
 * Best-effort Control Center realtime fan-out via Redis pub/sub.
 * Payload shape matches api/src/realtime/realtime-hub.service.ts ControlCenterRealtimePayload.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishControlCenterUpdate = publishControlCenterUpdate;
const CONTROL_CENTER_CHANNEL = "archaser:realtime:control-center";
let warnedMissingRedis = false;
async function publishControlCenterUpdate(reason, options) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        if (!warnedMissingRedis) {
            warnedMissingRedis = true;
        }
        return;
    }
    const payload = {
        type: "control-center-update",
        data: options?.data ?? {},
        timestamp: Date.now(),
        reason,
        excludeFromNotifications: options?.excludeFromNotifications ?? true,
        source: options?.source ?? "automated",
    };
    let redis = null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const IORedis = require("ioredis");
        redis = new IORedis(redisUrl, {
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            enableOfflineQueue: false,
            retryStrategy: (times) => times > 2 ? null : Math.min(times * 200, 1000),
        });
        await redis.publish(CONTROL_CENTER_CHANNEL, JSON.stringify(payload));
    }
    catch {
        // Best-effort — do not throw
    }
    finally {
        if (redis) {
            try {
                await redis.quit();
            }
            catch {
                // ignore disconnect errors
            }
        }
    }
}
