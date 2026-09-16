/**
 * Single-pass derive of capacity-gap + overshoot metrics from a shared linked
 * CPT day series (avoids walking ~100k day rows twice on Portfolio Health).
 */

import type { LinkedCptCustomerDayRow } from "./linkedCptCustomerDaySeries";
import {
    computeCustomerOverLimitGapMetrics,
    summarizePortfolioOverLimitGap,
    type CustomerOverLimitGapRow,
    type PortfolioOverLimitGapSummary,
} from "./shared/ctpOverLimitGapMetrics";
import {
    computeCustomerOvershootLimitCappedMetrics,
    rankCustomersByOvershoot,
    summarizePortfolioOvershoot,
    type CustomerOvershootLimitCappedRow,
    type PortfolioOvershootSummary,
} from "./shared/ctpOvershootLimitCappedMetrics";

type CapacityEntry = {
    customerName: string;
    points: Array<{ snapshotDate: string; capacityGapAmount: number }>;
};

type OvershootEntry = {
    customerName: string;
    utilizationPoints: Array<{
        snapshotDate: string;
        utilizationPct: number | null;
    }>;
    limitCappedPoints: Array<{
        snapshotDate: string;
        totalReceivables: number;
        compliantExposure: number;
    }>;
};

/**
 * One walk of the day series → capacity-gap summary + overshoot summary.
 */
export function deriveCapacityAndOvershootFromLinkedCptDaySeries(
    dayRows: LinkedCptCustomerDayRow[]
): {
    capacity: {
        rows: CustomerOverLimitGapRow[];
        summary: PortfolioOverLimitGapSummary;
    };
    overshoot: {
        rows: CustomerOvershootLimitCappedRow[];
        summary: PortfolioOvershootSummary;
        overshootRanking: CustomerOvershootLimitCappedRow[];
        limitCappedRows: CustomerOvershootLimitCappedRow[];
    };
} {
    const capacityByCustomer = new Map<number, CapacityEntry>();
    const overshootByCustomer = new Map<number, OvershootEntry>();

    for (const row of dayRows) {
        let overshootEntry = overshootByCustomer.get(row.customerId);
        if (!overshootEntry) {
            overshootEntry = {
                customerName: row.customerName,
                utilizationPoints: [],
                limitCappedPoints: [],
            };
            overshootByCustomer.set(row.customerId, overshootEntry);
        }
        overshootEntry.utilizationPoints.push({
            snapshotDate: row.snapshotDate,
            utilizationPct: row.effectiveUsagePct,
        });
        overshootEntry.limitCappedPoints.push({
            snapshotDate: row.snapshotDate,
            totalReceivables: row.totalReceivables,
            compliantExposure: row.compliantExposure,
        });

        if (!row.approvedDay) {
            continue;
        }
        let capacityEntry = capacityByCustomer.get(row.customerId);
        if (!capacityEntry) {
            capacityEntry = {
                customerName: row.customerName,
                points: [],
            };
            capacityByCustomer.set(row.customerId, capacityEntry);
        }
        capacityEntry.points.push({
            snapshotDate: row.snapshotDate,
            capacityGapAmount: row.approvedCapacityGapAmount,
        });
    }

    const capacityRows: CustomerOverLimitGapRow[] = [];
    for (const [customerId, entry] of capacityByCustomer) {
        capacityRows.push({
            customerId,
            customerName: entry.customerName,
            ...computeCustomerOverLimitGapMetrics(entry.points),
        });
    }

    const overshootRows: CustomerOvershootLimitCappedRow[] = [];
    for (const [customerId, entry] of overshootByCustomer) {
        overshootRows.push({
            customerId,
            customerName: entry.customerName,
            ...computeCustomerOvershootLimitCappedMetrics({
                utilizationPoints: entry.utilizationPoints,
                limitCappedPoints: entry.limitCappedPoints,
            }),
        });
    }

    return {
        capacity: {
            rows: capacityRows,
            summary: summarizePortfolioOverLimitGap(capacityRows),
        },
        overshoot: {
            rows: overshootRows,
            summary: summarizePortfolioOvershoot(overshootRows),
            overshootRanking: rankCustomersByOvershoot(overshootRows),
            limitCappedRows: overshootRows.filter(
                (r) => r.limitCapped.limitCapped
            ),
        },
    };
}
