import type { PrismaClient } from "@prisma/client";
import { refreshInsuranceTargetDatesViaHost } from "../credit/arPostIngestHost";
import type { TailStepState } from "./connectorSyncRuntime";

/**
 * Dedicated tail step: refresh invoice insurance target dates before AR replay.
 * Progress counts invoices examined (chunked), not only rows that changed.
 */
export async function runInsuranceTargetsTailStep(params: {
    invoiceIds: number[];
    prisma: PrismaClient;
    setTailStep: (state: TailStepState) => void;
    log: (message: string) => void;
}): Promise<void> {
    const invoiceIds = Array.from(
        new Set(params.invoiceIds.filter((id) => Number.isFinite(id) && id > 0))
    );
    if (invoiceIds.length === 0) {
        return;
    }

    const total = invoiceIds.length;
    params.setTailStep({
        status: "running",
        processed: 0,
        total,
        detail: {
            step: "insurance_targets",
            processed: 0,
            total,
        },
    });
    params.log(
        `Insurance target dates starting for ${total} invoice(s)…`
    );

    try {
        let lastLoggedProcessed = -1;
        const updated = await refreshInsuranceTargetDatesViaHost(
            invoiceIds,
            params.prisma,
            {
                onProgress: ({ processed, total: progressTotal }) => {
                    params.setTailStep({
                        status: "running",
                        processed,
                        total: progressTotal,
                        detail: {
                            step: "insurance_targets",
                            processed,
                            total: progressTotal,
                        },
                    });
                    // Log each progress tick (chunk) so Nest logs show movement.
                    if (processed !== lastLoggedProcessed) {
                        lastLoggedProcessed = processed;
                        params.log(
                            `Insurance target dates progress: ${processed}/${progressTotal} invoice(s)`
                        );
                    }
                },
            }
        );
        params.setTailStep({
            status: "done",
            processed: total,
            total,
            detail: {
                step: "insurance_targets",
                processed: total,
                total,
            },
        });
        params.log(
            `Insurance target dates finished for ${total} invoice(s) (${updated} updated)`
        );
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Insurance target date refresh failed";
        params.log(`Insurance target dates failed: ${message}`);
        params.setTailStep({
            status: "failed",
            processed: 0,
            total,
            error: message,
        });
    }
}
