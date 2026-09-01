import type { TailStepState } from "./connectorSyncRuntime";

export type ProcessOverdueCustomersFn = (
    customerIds: number[]
) => Promise<void>;

/** Customers processed per progress tick during the Process Overdue tail step. */
const PROCESS_OVERDUE_PROGRESS_CHUNK = 10;

/**
 * One batched Process Overdue pass for all touched customers — its own tail
 * step so rollups finish inline before deferred CI post-ingest.
 */
export async function runProcessOverdueTailStep(params: {
    customerIds: number[];
    setTailStep: (state: TailStepState) => void;
    onProcessOverdueCustomers: ProcessOverdueCustomersFn;
    log: (message: string) => void;
}): Promise<void> {
    const customerIds = Array.from(
        new Set(params.customerIds.filter(Number.isFinite))
    );
    if (customerIds.length === 0) {
        return;
    }

    params.setTailStep({
        status: "running",
        processed: 0,
        total: customerIds.length,
        detail: {
            step: "process_overdue",
            processed: 0,
            total: customerIds.length,
        },
    });
    params.log(
        `Process Overdue starting for ${customerIds.length} customer(s)…`
    );
    try {
        const total = customerIds.length;
        for (let i = 0; i < total; i += PROCESS_OVERDUE_PROGRESS_CHUNK) {
            const chunk = customerIds.slice(
                i,
                i + PROCESS_OVERDUE_PROGRESS_CHUNK
            );
            await params.onProcessOverdueCustomers(chunk);
            const processed = Math.min(i + chunk.length, total);
            params.setTailStep({
                status: "running",
                processed,
                total,
                detail: {
                    step: "process_overdue",
                    processed,
                    total,
                },
            });
        }
        params.setTailStep({
            status: "done",
            processed: customerIds.length,
            total: customerIds.length,
            detail: {
                step: "process_overdue",
                processed: customerIds.length,
                total: customerIds.length,
            },
        });
        params.log(
            `Process Overdue finished for ${customerIds.length} customer(s)`
        );
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Process Overdue failed";
        params.log(`Process Overdue failed: ${message}`);
        params.setTailStep({
            status: "failed",
            processed: 0,
            total: customerIds.length,
            error: message,
        });
    }
}
