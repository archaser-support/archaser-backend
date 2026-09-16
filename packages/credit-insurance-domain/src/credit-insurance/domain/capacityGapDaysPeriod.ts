/**
 * Period CTP cohort for chronic over-limit Portfolio Health roll-ups and
 * customer trailing status. Includes approved customers with available days
 * even when never over limit.
 */

import {
    computeCustomerOverLimitGapMetrics,
    summarizePortfolioOverLimitGap,
    type CustomerOverLimitGapRow,
    type PortfolioOverLimitGapSummary,
} from "./shared/ctpOverLimitGapMetrics";
import {
    fetchLinkedCptCustomerDaySeries,
    type FetchLinkedCptCustomerDaySeriesOptions,
    type LinkedCptCustomerDayRow,
} from "./linkedCptCustomerDaySeries";

export type FetchCapacityGapDaysPeriodOptions =
    FetchLinkedCptCustomerDaySeriesOptions;

/**
 * Build capacity-gap customer rows from a shared linked CPT day series.
 * Only positive-limit (approved) days are included — same as the historical
 * dedicated SQL filter.
 */
export function mapLinkedCptDaySeriesToCapacityGapCustomers(
    dayRows: LinkedCptCustomerDayRow[]
): CustomerOverLimitGapRow[] {
    const byCustomer = new Map<
        number,
        {
            customerName: string;
            points: Array<{ snapshotDate: string; capacityGapAmount: number }>;
        }
    >();

    for (const row of dayRows) {
        if (!row.approvedDay) {
            continue;
        }
        let entry = byCustomer.get(row.customerId);
        if (!entry) {
            entry = {
                customerName: row.customerName,
                points: [],
            };
            byCustomer.set(row.customerId, entry);
        }
        entry.points.push({
            snapshotDate: row.snapshotDate,
            capacityGapAmount: row.approvedCapacityGapAmount,
        });
    }

    const result: CustomerOverLimitGapRow[] = [];
    for (const [customerId, entry] of byCustomer) {
        const metrics = computeCustomerOverLimitGapMetrics(entry.points);
        result.push({
            customerId,
            customerName: entry.customerName,
            ...metrics,
        });
    }
    return result;
}

/**
 * Approved CTP rows in range (linked policy, not excluded, positive effective
 * limit), aggregated per customer with over-limit metrics.
 */
export async function fetchCapacityGapDaysPeriodCustomers(
    options: FetchCapacityGapDaysPeriodOptions
): Promise<CustomerOverLimitGapRow[]> {
    const dayRows = await fetchLinkedCptCustomerDaySeries(options);
    return mapLinkedCptDaySeriesToCapacityGapCustomers(dayRows);
}

export async function fetchCapacityGapDaysPeriodSummary(
    options: FetchCapacityGapDaysPeriodOptions
): Promise<{
    rows: CustomerOverLimitGapRow[];
    summary: PortfolioOverLimitGapSummary;
}> {
    const rows = await fetchCapacityGapDaysPeriodCustomers(options);
    return {
        rows,
        summary: summarizePortfolioOverLimitGap(rows),
    };
}

export function summarizeCapacityGapFromLinkedCptDaySeries(
    dayRows: LinkedCptCustomerDayRow[]
): {
    rows: CustomerOverLimitGapRow[];
    summary: PortfolioOverLimitGapSummary;
} {
    const rows = mapLinkedCptDaySeriesToCapacityGapCustomers(dayRows);
    return {
        rows,
        summary: summarizePortfolioOverLimitGap(rows),
    };
}

/**
 * Trailing-window metrics for one customer (Customer dashboard status line).
 * Uses the same approved-day filter when the customer has a linked approved policy;
 * otherwise returns empty metrics (no data).
 */
export async function fetchCustomerTrailingOverLimitGapMetrics(options: {
    accountId: number;
    customerId: number;
    policyId?: number;
    /** Trailing available calendar span end = today UTC; default 90. */
    days?: number;
}): Promise<CustomerOverLimitGapRow | null> {
    const days = Math.min(365, Math.max(7, options.days ?? 90));
    const toDateUtc = new Date();
    toDateUtc.setUTCHours(0, 0, 0, 0);
    const fromDateUtc = new Date(toDateUtc);
    fromDateUtc.setUTCDate(fromDateUtc.getUTCDate() - (days - 1));

    const fromDate = fromDateUtc.toISOString().slice(0, 10);
    const toDate = toDateUtc.toISOString().slice(0, 10);

    const rows = await fetchCapacityGapDaysPeriodCustomers({
        accountId: options.accountId,
        customerId: options.customerId,
        policyId: options.policyId,
        fromDate,
        toDate,
        includeNoPolicyExposure: true,
    });
    return rows[0] ?? null;
}
