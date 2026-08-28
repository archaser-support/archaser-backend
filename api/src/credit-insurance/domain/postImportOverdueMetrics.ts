/**
 * Thin live-refresh entry after import/sync: recompute MEP / overdue block and
 * run the capacity-gap pipeline via existing customer insurance sync follow-up.
 */
import { syncCustomerInsuranceFields } from "./syncCustomerInsuranceFields";

export type PostImportOverdueMetricsError = {
    customerId: number;
    message: string;
};

export type TriggerPostImportOverdueMetricsResult = {
    customersAttempted: number;
    errors: PostImportOverdueMetricsError[];
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * When customerIds are provided, only those customers are synced (fast path).
 * Empty / omitted ids are a no-op — callers pass affected AR customers.
 * Per-customer failures are logged and collected; the function does not throw.
 */
export async function triggerPostImportOverdueMetrics(
    customerIds?: number[]
): Promise<TriggerPostImportOverdueMetricsResult> {
    const uniqueIds = customerIds?.length
        ? Array.from(new Set(customerIds.filter(Number.isFinite)))
        : [];

    if (uniqueIds.length === 0) {
        return { customersAttempted: 0, errors: [] };
    }

    const errors: PostImportOverdueMetricsError[] = [];

    for (const customerId of uniqueIds) {
        try {
            await syncCustomerInsuranceFields(customerId, {
                runFollowUpEffects: true,
            });
        } catch (error) {
            const message = errorMessage(error);
            console.error(
                "[postImportOverdueMetrics] syncCustomerInsuranceFields failed",
                { customerId, message }
            );
            errors.push({ customerId, message });
        }
    }

    return { customersAttempted: uniqueIds.length, errors };
}
