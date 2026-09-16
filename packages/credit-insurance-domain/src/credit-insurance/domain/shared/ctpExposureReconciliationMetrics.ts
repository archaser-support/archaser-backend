/**
 * AR / exposure reconciliation check (Bucket 1 KPI #13).
 *
 * Flags CPT rows where at_risk + compliant ≠ total receivables beyond a small
 * epsilon, and separately flags at_risk > total (stronger integrity signal).
 * Visibility only — never filters/hides underlying dashboard data.
 */

/** Default absolute delta tolerance (account currency units). */
export const RECONCILIATION_ABS_DELTA_EPSILON = 1;

export type ReconciliationThresholds = {
    epsilon?: number;
};

export type ExposureReconciliationInput = {
    customerId: number;
    customerName?: string;
    snapshotDate: string;
    totalReceivables: number;
    atRiskExposure: number;
    compliantExposure: number;
};

export type ExposureReconciliationFlaggedRow = {
    customerId: number;
    customerName: string;
    snapshotDate: string;
    totalReceivables: number;
    atRiskExposure: number;
    compliantExposure: number;
    /** (at_risk + compliant) − total_receivables. */
    delta: number;
    identityFailed: boolean;
    atRiskExceedsTotal: boolean;
};

export type CustomerExposureReconciliationSummary = {
    customerId: number;
    customerName: string;
    failingRowCount: number;
    maxAbsDelta: number | null;
    worstDeltaDate: string | null;
    atRiskExceedsTotalRowCount: number;
    maxAtRiskExcess: number | null;
};

export type PortfolioExposureReconciliationSummary = {
    failingRowCount: number;
    maxAbsDelta: number | null;
    customersAffected: number;
    atRiskExceedsTotalRowCount: number;
    atRiskExceedsTotalCustomers: number;
    maxAtRiskExcess: number | null;
    epsilon: number;
};

function resolveEpsilon(thresholds?: ReconciliationThresholds): number {
    const e = thresholds?.epsilon;
    if (e == null || !Number.isFinite(e) || e < 0) {
        return RECONCILIATION_ABS_DELTA_EPSILON;
    }
    return e;
}

export function evaluateExposureReconciliation(
    totalReceivables: number,
    atRiskExposure: number,
    compliantExposure: number,
    thresholds?: ReconciliationThresholds
): {
    delta: number;
    identityFailed: boolean;
    atRiskExceedsTotal: boolean;
} {
    const epsilon = resolveEpsilon(thresholds);
    const total = Number.isFinite(totalReceivables) ? totalReceivables : 0;
    const atRisk = Number.isFinite(atRiskExposure) ? atRiskExposure : 0;
    const compliant = Number.isFinite(compliantExposure)
        ? compliantExposure
        : 0;
    const delta = atRisk + compliant - total;
    const identityFailed = Math.abs(delta) > epsilon;
    const atRiskExceedsTotal = atRisk - total > epsilon;
    return { delta, identityFailed, atRiskExceedsTotal };
}

export function collectExposureReconciliationFailures(
    rows: ExposureReconciliationInput[],
    thresholds?: ReconciliationThresholds
): ExposureReconciliationFlaggedRow[] {
    const out: ExposureReconciliationFlaggedRow[] = [];
    for (const row of rows) {
        const result = evaluateExposureReconciliation(
            row.totalReceivables,
            row.atRiskExposure,
            row.compliantExposure,
            thresholds
        );
        if (!result.identityFailed && !result.atRiskExceedsTotal) {
            continue;
        }
        out.push({
            customerId: row.customerId,
            customerName: row.customerName?.trim() || String(row.customerId),
            snapshotDate: row.snapshotDate,
            totalReceivables: row.totalReceivables,
            atRiskExposure: row.atRiskExposure,
            compliantExposure: row.compliantExposure,
            delta: result.delta,
            identityFailed: result.identityFailed,
            atRiskExceedsTotal: result.atRiskExceedsTotal,
        });
    }
    return out.sort((a, b) => {
        const byAbs = Math.abs(b.delta) - Math.abs(a.delta);
        if (byAbs !== 0) {
            return byAbs;
        }
        const byDate = b.snapshotDate.localeCompare(a.snapshotDate);
        if (byDate !== 0) {
            return byDate;
        }
        return a.customerId - b.customerId;
    });
}

export function summarizeCustomerExposureReconciliation(
    rows: ExposureReconciliationFlaggedRow[]
): CustomerExposureReconciliationSummary[] {
    const byCustomer = new Map<number, ExposureReconciliationFlaggedRow[]>();
    for (const row of rows) {
        const list = byCustomer.get(row.customerId) ?? [];
        list.push(row);
        byCustomer.set(row.customerId, list);
    }

    const summaries: CustomerExposureReconciliationSummary[] = [];
    for (const [customerId, list] of byCustomer) {
        let maxAbsDelta = 0;
        let worst: ExposureReconciliationFlaggedRow | null = null;
        let atRiskExceedsTotalRowCount = 0;
        let maxAtRiskExcess = 0;
        let failingRowCount = 0;
        for (const row of list) {
            if (row.identityFailed) {
                failingRowCount += 1;
                const abs = Math.abs(row.delta);
                if (worst == null || abs > maxAbsDelta) {
                    maxAbsDelta = abs;
                    worst = row;
                }
            }
            if (row.atRiskExceedsTotal) {
                atRiskExceedsTotalRowCount += 1;
                const excess = row.atRiskExposure - row.totalReceivables;
                if (excess > maxAtRiskExcess) {
                    maxAtRiskExcess = excess;
                }
            }
        }
        summaries.push({
            customerId,
            customerName: list[0]?.customerName ?? String(customerId),
            failingRowCount,
            maxAbsDelta: failingRowCount > 0 ? maxAbsDelta : null,
            worstDeltaDate: worst?.snapshotDate ?? null,
            atRiskExceedsTotalRowCount,
            maxAtRiskExcess:
                atRiskExceedsTotalRowCount > 0 ? maxAtRiskExcess : null,
        });
    }

    return summaries.sort((a, b) => {
        const byFail = b.failingRowCount - a.failingRowCount;
        if (byFail !== 0) {
            return byFail;
        }
        return (b.maxAbsDelta ?? 0) - (a.maxAbsDelta ?? 0);
    });
}

export function summarizePortfolioExposureReconciliation(
    rows: ExposureReconciliationFlaggedRow[],
    thresholds?: ReconciliationThresholds
): PortfolioExposureReconciliationSummary {
    let failingRowCount = 0;
    let maxAbsDelta = 0;
    let atRiskExceedsTotalRowCount = 0;
    let maxAtRiskExcess = 0;
    const identityCustomers = new Set<number>();
    const atRiskCustomers = new Set<number>();

    for (const row of rows) {
        if (row.identityFailed) {
            failingRowCount += 1;
            identityCustomers.add(row.customerId);
            const abs = Math.abs(row.delta);
            if (abs > maxAbsDelta) {
                maxAbsDelta = abs;
            }
        }
        if (row.atRiskExceedsTotal) {
            atRiskExceedsTotalRowCount += 1;
            atRiskCustomers.add(row.customerId);
            const excess = row.atRiskExposure - row.totalReceivables;
            if (excess > maxAtRiskExcess) {
                maxAtRiskExcess = excess;
            }
        }
    }

    return {
        failingRowCount,
        maxAbsDelta: failingRowCount > 0 ? maxAbsDelta : null,
        customersAffected: identityCustomers.size,
        atRiskExceedsTotalRowCount,
        atRiskExceedsTotalCustomers: atRiskCustomers.size,
        maxAtRiskExcess:
            atRiskExceedsTotalRowCount > 0 ? maxAtRiskExcess : null,
        epsilon: resolveEpsilon(thresholds),
    };
}
