import { Gauge, type Registry } from "prom-client";
import type { Queue } from "bullmq";

/** Stable Grafana/alert labels (not Redis queue name — prod cron is archaser-cron-prod). */
export type BullmqLogicalQueue =
    | "cron"
    | "credit_asof_backfill"
    | "account_vat_basis_refresh";

export type BullmqQueueMetricHandles = {
    waiting: Gauge<"queue">;
    active: Gauge<"queue">;
    failed: Gauge<"queue">;
    refresh: () => Promise<void>;
};

export function registerBullmqQueueMetrics(
    register: Registry,
    queues: Partial<Record<BullmqLogicalQueue, Queue | null | undefined>>
): BullmqQueueMetricHandles {
    const waiting = new Gauge({
        name: "archaser_bullmq_queue_waiting",
        help: "BullMQ jobs in waiting state by logical queue",
        labelNames: ["queue"],
        registers: [register],
    });
    const active = new Gauge({
        name: "archaser_bullmq_queue_active",
        help: "BullMQ jobs in active state by logical queue",
        labelNames: ["queue"],
        registers: [register],
    });
    const failed = new Gauge({
        name: "archaser_bullmq_queue_failed",
        help: "BullMQ jobs in failed state by logical queue",
        labelNames: ["queue"],
        registers: [register],
    });

    const refresh = async () => {
        for (const [logical, queue] of Object.entries(queues) as Array<
            [BullmqLogicalQueue, Queue | null | undefined]
        >) {
            if (!queue) {
                waiting.set({ queue: logical }, 0);
                active.set({ queue: logical }, 0);
                failed.set({ queue: logical }, 0);
                continue;
            }
            try {
                const counts = await queue.getJobCounts(
                    "waiting",
                    "active",
                    "failed"
                );
                waiting.set({ queue: logical }, counts.waiting ?? 0);
                active.set({ queue: logical }, counts.active ?? 0);
                failed.set({ queue: logical }, counts.failed ?? 0);
            } catch {
                // Keep last values on transient Redis errors.
            }
        }
    };

    return { waiting, active, failed, refresh };
}
