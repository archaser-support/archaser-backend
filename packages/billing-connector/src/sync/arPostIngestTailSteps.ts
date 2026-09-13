import type { PrismaClient } from "@prisma/client";
import type { ArPostIngestHostFn } from "../credit/arPostIngestHost";
import {
    AR_REPLAY_ENTITY_STATS_KEY,
    INSURANCE_TARGETS_ENTITY_STATS_KEY,
    LIVE_REFRESH_ENTITY_STATS_KEY,
    PROCESS_OVERDUE_ENTITY_STATS_KEY,
    type TailStepKey,
    type TailStepState,
} from "./connectorSyncRuntime";
import {
    buildCustomerPositionTailDetail,
    mapHostProgressToCustomerScopedInner,
} from "./customerScopedTailProgress";
import { runInsuranceTargetsTailStep } from "./insuranceTargetsTailStep";
import {
    runProcessOverdueTailStep,
    type ProcessOverdueCustomersFn,
} from "./processOverdueTailStep";

/** Customers processed per progress tick during inline AR replay / live refresh. */
export const AR_POST_INGEST_CUSTOMER_CHUNK = 10;

export type RunInlineArPostIngestTailStepsParams = {
    accountId: number;
    customerIds: number[];
    invoiceEntityIds: number[];
    paymentEntityIds: number[];
    mepBreachStartDate?: Date | null;
    prisma?: PrismaClient;
    onArPostIngest: ArPostIngestHostFn | undefined;
    log: (message: string) => void;
    setTailStep: (key: TailStepKey, state: TailStepState) => void;
    /** When Process Overdue already ran as its own tail step. */
    separateOverdueStep: boolean;
    onProcessOverdueCustomers?: ProcessOverdueCustomersFn;
    runMaturity?: boolean;
    importType: "Invoice" | "Payment";
};

type ChunkProgressHelpers = {
    /** Customers fully finished before this chunk started. */
    customersDoneBeforeChunk: number;
    /** Total customers for this tail step. */
    customerTotal: number;
    /**
     * Forward in-chunk host progress (e.g. replay events for the current
     * customer) into the tail-step detail without waiting for the chunk to end.
     */
    reportInnerProgress: (progress: {
        customersCompletedInChunk: number;
        detail?: {
            processed: number;
            total: number;
            customer_id?: number;
            customer_label?: string;
            customer_index?: number;
            customer_total?: number;
        };
    }) => void;
};

async function runChunkedHostStep(params: {
    customerIds: number[];
    tailKey: TailStepKey;
    detailStep: string;
    logLabel: string;
    setTailStep: (key: TailStepKey, state: TailStepState) => void;
    log: (message: string) => void;
    runChunk: (chunk: number[], helpers: ChunkProgressHelpers) => Promise<void>;
}): Promise<void> {
    const customerIds = Array.from(
        new Set(params.customerIds.filter(Number.isFinite))
    );
    if (customerIds.length === 0) {
        return;
    }

    params.setTailStep(params.tailKey, {
        status: "running",
        processed: 0,
        total: customerIds.length,
        detail: buildCustomerPositionTailDetail({
            step: params.detailStep,
            customersCompleted: 0,
            customerTotal: customerIds.length,
        }),
    });
    params.log(`${params.logLabel} starting for ${customerIds.length} customer(s)…`);

    try {
        const total = customerIds.length;
        let lastInnerEmitAt = 0;
        for (let i = 0; i < total; i += AR_POST_INGEST_CUSTOMER_CHUNK) {
            const chunk = customerIds.slice(
                i,
                i + AR_POST_INGEST_CUSTOMER_CHUNK
            );
            const chunkEnd = Math.min(i + chunk.length, total);
            const customersDoneBeforeChunk = i;
            await params.runChunk(chunk, {
                customersDoneBeforeChunk,
                customerTotal: total,
                reportInnerProgress: ({
                    customersCompletedInChunk,
                    detail,
                }) => {
                    const nowMs = Date.now();
                    // Event ticks can be frequent; keep UI responsive without flooding.
                    if (
                        detail &&
                        nowMs - lastInnerEmitAt < 250 &&
                        detail.processed < (detail.total ?? 0)
                    ) {
                        return;
                    }
                    lastInnerEmitAt = nowMs;
                    const customersFinished = Math.min(
                        total,
                        customersDoneBeforeChunk +
                            Math.max(0, customersCompletedInChunk)
                    );
                    const customerIndex =
                        detail?.customer_index ??
                        Math.min(
                            total,
                            customersFinished + (detail ? 1 : 0)
                        );
                    const customerTotal = detail?.customer_total ?? total;
                    params.setTailStep(params.tailKey, {
                        status: "running",
                        processed: customersFinished,
                        total,
                        detail: detail
                            ? {
                                  step: params.detailStep,
                                  processed: detail.processed,
                                  total: detail.total,
                                  customer_index: customerIndex,
                                  customer_total: customerTotal,
                                  ...(detail.customer_id != null
                                      ? { customer_id: detail.customer_id }
                                      : {}),
                                  ...(detail.customer_label
                                      ? {
                                            customer_label:
                                                detail.customer_label,
                                        }
                                      : {}),
                              }
                            : buildCustomerPositionTailDetail({
                                  step: params.detailStep,
                                  customersCompleted: customersFinished,
                                  customerTotal: total,
                              }),
                    });
                },
            });
            const processed = chunkEnd;
            params.setTailStep(params.tailKey, {
                status: "running",
                processed,
                total,
                detail: buildCustomerPositionTailDetail({
                    step: params.detailStep,
                    customersCompleted: processed,
                    customerTotal: total,
                }),
            });
        }
        params.setTailStep(params.tailKey, {
            status: "done",
            processed: customerIds.length,
            total: customerIds.length,
            detail: buildCustomerPositionTailDetail({
                step: params.detailStep,
                customersCompleted: customerIds.length,
                customerTotal: customerIds.length,
            }),
        });
        params.log(
            `${params.logLabel} finished for ${customerIds.length} customer(s)`
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : `${params.logLabel} failed`;
        params.log(`${params.logLabel} failed: ${message}`);
        params.setTailStep(params.tailKey, {
            status: "failed",
            processed: 0,
            total: customerIds.length,
            error: message,
        });
    }
}

/**
 * Inline AR post-ingest tail: Process Overdue (optional) → insurance target
 * dates → replay → live refresh → as-of enqueue. Each step is its own progress row.
 */
export async function runInlineArPostIngestTailSteps(
    params: RunInlineArPostIngestTailStepsParams
): Promise<void> {
    const customerIds = Array.from(
        new Set(params.customerIds.filter(Number.isFinite))
    );
    if (customerIds.length === 0) {
        return;
    }
    if (!params.onArPostIngest) {
        params.log(
            "AR post-ingest skipped: onArPostIngest is not configured"
        );
        return;
    }

    if (
        !params.separateOverdueStep &&
        params.onProcessOverdueCustomers &&
        customerIds.length > 0
    ) {
        await runProcessOverdueTailStep({
            customerIds,
            onProcessOverdueCustomers: params.onProcessOverdueCustomers,
            log: params.log,
            prisma: params.prisma,
            setTailStep: (state) =>
                params.setTailStep(PROCESS_OVERDUE_ENTITY_STATS_KEY, state),
        });
    }

    // Target dates must be current before AR replay (sign flips / MEP window).
    if (params.invoiceEntityIds.length > 0 && params.prisma) {
        await runInsuranceTargetsTailStep({
            invoiceIds: params.invoiceEntityIds,
            prisma: params.prisma,
            log: params.log,
            setTailStep: (state) =>
                params.setTailStep(INSURANCE_TARGETS_ENTITY_STATS_KEY, state),
        });
    }

    const hostBase = {
        accountId: params.accountId,
        invoiceEntityIds: params.invoiceEntityIds,
        paymentEntityIds: params.paymentEntityIds,
        mepBreachStartDate: params.mepBreachStartDate,
        affectedInvoiceIds: params.invoiceEntityIds,
    };

    if (params.runMaturity === true) {
        await params.onArPostIngest!({
            ...hostBase,
            customerIds,
            runReplay: false,
            runLiveRefresh: false,
            runProcessOverdue: false,
            runMaturity: true,
            enqueueAsOfRewrite: false,
        });
    }

    await runChunkedHostStep({
        customerIds,
        tailKey: AR_REPLAY_ENTITY_STATS_KEY,
        detailStep: "replay",
        logLabel: "AR replay",
        setTailStep: params.setTailStep,
        log: params.log,
        runChunk: async (chunk, helpers) => {
            await params.onArPostIngest!({
                ...hostBase,
                customerIds: chunk,
                runReplay: true,
                runLiveRefresh: false,
                runProcessOverdue: false,
                runMaturity: false,
                enqueueAsOfRewrite: false,
                onProgress: (progress) => {
                    helpers.reportInnerProgress({
                        customersCompletedInChunk: progress.completed,
                        detail: mapHostProgressToCustomerScopedInner({
                            step: "replay",
                            hostStep: progress.step,
                            customerId: progress.customerId,
                            detail: progress.detail,
                            customersDoneBeforeChunk:
                                helpers.customersDoneBeforeChunk,
                            customerTotal: helpers.customerTotal,
                        }),
                    });
                },
            });
        },
    });

    await runChunkedHostStep({
        customerIds,
        tailKey: LIVE_REFRESH_ENTITY_STATS_KEY,
        detailStep: "live_refresh",
        logLabel: "Insurance live refresh",
        setTailStep: params.setTailStep,
        log: params.log,
        runChunk: async (chunk, helpers) => {
            await params.onArPostIngest!({
                ...hostBase,
                customerIds: chunk,
                runReplay: false,
                runLiveRefresh: true,
                runProcessOverdue: false,
                runMaturity: false,
                enqueueAsOfRewrite: false,
                onProgress: (progress) => {
                    helpers.reportInnerProgress({
                        customersCompletedInChunk: progress.completed,
                        detail: mapHostProgressToCustomerScopedInner({
                            step: "live_refresh",
                            hostStep: progress.step,
                            customerId: progress.customerId,
                            detail: progress.detail,
                            customersDoneBeforeChunk:
                                helpers.customersDoneBeforeChunk,
                            customerTotal: helpers.customerTotal,
                        }),
                    });
                },
            });
        },
    });

    const asOfRewrite = {
        importType: params.importType,
        entityIds:
            params.importType === "Invoice"
                ? params.invoiceEntityIds
                : params.paymentEntityIds,
    };

    try {
        await params.onArPostIngest!({
            ...hostBase,
            customerIds,
            runReplay: false,
            runLiveRefresh: false,
            runProcessOverdue: false,
            runMaturity: false,
            enqueueAsOfRewrite: true,
            asOfRewrite,
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "As-of rewrite enqueue failed";
        params.log(`As-of rewrite enqueue failed: ${message}`);
    }
}
