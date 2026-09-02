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
export declare function publishControlCenterUpdate(reason: string, options?: {
    excludeFromNotifications?: boolean;
    source?: ControlCenterRealtimePayload["source"];
    data?: Record<string, unknown>;
}): Promise<void>;
