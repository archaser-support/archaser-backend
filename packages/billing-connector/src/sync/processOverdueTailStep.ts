import type { PrismaClient } from "@prisma/client";

import type { TailStepState } from "./connectorSyncRuntime";
import {
    buildCustomerScopedTailDetail,
    loadCustomerProgressLabels,
} from "./customerScopedTailProgress";

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
    /** When set, progress detail shows customer_number + position. */
    prisma?: Pick<PrismaClient, "customer">;
}): Promise<void> {
    const customerIds = Array.from(
        new Set(params.customerIds.filter(Number.isFinite))
    );
    if (customerIds.length === 0) {
        return;
    }

    const customerTotal = customerIds.length;
    const labels = params.prisma
        ? await loadCustomerProgressLabels(params.prisma, customerIds)
        : new Map<number, string>();

    const detailFor = (customerId: number, customerIndex: number) =>
        buildCustomerScopedTailDetail({
            step: "process_overdue",
            customerId,
            customerLabel: labels.get(customerId) ?? undefined,
            customerIndex,
            customerTotal,
        });

    params.setTailStep({
        status: "running",
        processed: 0,
        total: customerTotal,
        detail: detailFor(customerIds[0]!, 1),
    });
    params.log(
        `Process Overdue starting for ${customerTotal} customer(s)…`
    );
    try {
        for (
            let i = 0;
            i < customerTotal;
            i += PROCESS_OVERDUE_PROGRESS_CHUNK
        ) {
            const chunk = customerIds.slice(
                i,
                i + PROCESS_OVERDUE_PROGRESS_CHUNK
            );
            const inFlightId = chunk[0]!;
            params.setTailStep({
                status: "running",
                processed: i,
                total: customerTotal,
                detail: detailFor(inFlightId, i + 1),
            });
            await params.onProcessOverdueCustomers(chunk);
            const processed = Math.min(i + chunk.length, customerTotal);
            const lastId = chunk[chunk.length - 1]!;
            params.setTailStep({
                status: "running",
                processed,
                total: customerTotal,
                detail: detailFor(lastId, processed),
            });
        }
        params.setTailStep({
            status: "done",
            processed: customerTotal,
            total: customerTotal,
            detail: {
                step: "process_overdue",
                processed: customerTotal,
                total: customerTotal,
            },
        });
        params.log(
            `Process Overdue finished for ${customerTotal} customer(s)`
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
            total: customerTotal,
            error: message,
        });
    }
}
