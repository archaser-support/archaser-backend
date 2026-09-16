import type { PrismaClient } from "@prisma/client";

import type { TailStepDetail } from "./connectorSyncRuntime";

/**
 * Shared customer-scoped progress for backfill tail steps that walk customers
 * (AR replay, live refresh, and the same pattern for Process Overdue / etc.).
 *
 * Bar counters stay on {@link TailStepState.processed}/{@link TailStepState.total}
 * (customers done). The detail line carries who is in flight + optional inner
 * work (events, invoices, …).
 */
export type CustomerScopedInnerProgress = {
    processed: number;
    total: number;
};

export type CustomerScopedProgressInput = {
    step: string;
    customerId?: number;
    customerLabel?: string;
    /** 1-based index in the full step list. */
    customerIndex?: number;
    customerTotal?: number;
    /** Optional inner counter (replay events, etc.). */
    inner?: CustomerScopedInnerProgress;
};

/**
 * Build a {@link TailStepDetail} for a customer-scoped running step.
 */
export function buildCustomerScopedTailDetail(
    input: CustomerScopedProgressInput
): TailStepDetail {
    const inner = input.inner;
    return {
        step: input.step,
        processed: inner?.processed ?? 0,
        total: inner?.total ?? 0,
        ...(input.customerId != null
            ? { customer_id: input.customerId }
            : {}),
        ...(input.customerLabel
            ? { customer_label: input.customerLabel }
            : {}),
        ...(input.customerIndex != null
            ? { customer_index: input.customerIndex }
            : {}),
        ...(input.customerTotal != null
            ? { customer_total: input.customerTotal }
            : {}),
    };
}

/**
 * Between-customer tick: position only — never put customers-done into
 * processed/total (those fields are inner work, e.g. replay events).
 */
export function buildCustomerPositionTailDetail(input: {
    step: string;
    customersCompleted: number;
    customerTotal: number;
}): TailStepDetail {
    return {
        step: input.step,
        processed: 0,
        total: 0,
        customer_index: Math.max(0, input.customersCompleted),
        customer_total: Math.max(0, input.customerTotal),
    };
}

/**
 * Map host/orchestrator progress into the fields {@link runChunkedHostStep}
 * expects for mid-chunk UI updates.
 */
export function mapHostProgressToCustomerScopedInner(params: {
    step: string;
    hostStep?: string;
    customerId?: number;
    detail?: {
        processed: number;
        total: number;
        customerLabel?: string;
        customerIndex?: number;
        customerTotal?: number;
    };
    /** Added to host `customerIndex` when the host indexes within a chunk. */
    customersDoneBeforeChunk?: number;
    customerTotal?: number;
}):
    | {
          processed: number;
          total: number;
          customer_id?: number;
          customer_label?: string;
          customer_index?: number;
          customer_total?: number;
      }
    | undefined {
    if (params.hostStep !== params.step || !params.detail) {
        return undefined;
    }
    const chunkOffset = params.customersDoneBeforeChunk ?? 0;
    const indexFromHost =
        params.detail.customerIndex != null
            ? chunkOffset + params.detail.customerIndex
            : undefined;
    return {
        processed: params.detail.processed,
        total: params.detail.total,
        ...(params.customerId != null
            ? { customer_id: params.customerId }
            : {}),
        ...(params.detail.customerLabel
            ? { customer_label: params.detail.customerLabel }
            : {}),
        ...(indexFromHost != null ? { customer_index: indexFromHost } : {}),
        ...(params.customerTotal != null
            ? { customer_total: params.customerTotal }
            : params.detail.customerTotal != null
              ? { customer_total: params.detail.customerTotal }
              : {}),
    };
}

export function formatCustomerProgressLabel(row: {
    customer_number: string | null;
}): string | null {
    const number = row.customer_number?.trim();
    return number || null;
}

/**
 * Prefetch display labels (customer_number) for progress detail lines.
 */
export async function loadCustomerProgressLabels(
    prisma: Pick<PrismaClient, "customer">,
    customerIds: number[]
): Promise<Map<number, string>> {
    const unique = Array.from(
        new Set(customerIds.filter((id) => Number.isFinite(id) && id > 0))
    );
    const labels = new Map<number, string>();
    if (unique.length === 0) {
        return labels;
    }
    const rows = await prisma.customer.findMany({
        where: { id: { in: unique } },
        select: { id: true, customer_number: true },
    });
    for (const row of rows) {
        const label = formatCustomerProgressLabel(row);
        if (label) {
            labels.set(row.id, label);
        }
    }
    return labels;
}
