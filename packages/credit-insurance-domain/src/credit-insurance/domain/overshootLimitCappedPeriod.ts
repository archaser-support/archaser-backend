/**
 * Period CTP cohort for utilization overshoot (KPI #2) and limit-capped
 * detection (KPI #3). Approved customers with a positive effective limit on
 * at least one day; null-limit-only customers are excluded from overshoot.
 */

import {
    computeCustomerOvershootLimitCappedMetrics,
    rankCustomersByOvershoot,
    summarizePortfolioOvershoot,
    type CustomerOvershootLimitCappedRow,
    type PortfolioOvershootSummary,
} from "./shared/ctpOvershootLimitCappedMetrics";
import {
    fetchLinkedCptCustomerDaySeries,
    type FetchLinkedCptCustomerDaySeriesOptions,
    type LinkedCptCustomerDayRow,
} from "./linkedCptCustomerDaySeries";

export type FetchOvershootLimitCappedPeriodOptions =
    FetchLinkedCptCustomerDaySeriesOptions;

/**
 * Build overshoot / limit-capped customer rows from a shared linked CPT day
 * series. Zero-limit days keep AR/compliant for limit-capped and null util
 * for overshoot — same as the historical dedicated SQL.
 */
export function mapLinkedCptDaySeriesToOvershootLimitCappedCustomers(
    dayRows: LinkedCptCustomerDayRow[]
): CustomerOvershootLimitCappedRow[] {
    const byCustomer = new Map<
        number,
        {
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
        }
    >();

    for (const row of dayRows) {
        let entry = byCustomer.get(row.customerId);
        if (!entry) {
            entry = {
                customerName: row.customerName,
                utilizationPoints: [],
                limitCappedPoints: [],
            };
            byCustomer.set(row.customerId, entry);
        }
        entry.utilizationPoints.push({
            snapshotDate: row.snapshotDate,
            utilizationPct: row.effectiveUsagePct,
        });
        entry.limitCappedPoints.push({
            snapshotDate: row.snapshotDate,
            totalReceivables: row.totalReceivables,
            compliantExposure: row.compliantExposure,
        });
    }

    const result: CustomerOvershootLimitCappedRow[] = [];
    for (const [customerId, entry] of byCustomer) {
        const metrics = computeCustomerOvershootLimitCappedMetrics({
            utilizationPoints: entry.utilizationPoints,
            limitCappedPoints: entry.limitCappedPoints,
        });
        result.push({
            customerId,
            customerName: entry.customerName,
            ...metrics,
        });
    }
    return result;
}

/**
 * Approved CTP rows in range. Utilization % is size-weighted when multiple
 * policies share a day (usage ÷ effective limit). Days with no positive
 * effective limit contribute AR/compliant for limit-capped but null util for
 * overshoot exclusion.
 */
export async function fetchOvershootLimitCappedPeriodCustomers(
    options: FetchOvershootLimitCappedPeriodOptions
): Promise<CustomerOvershootLimitCappedRow[]> {
    const dayRows = await fetchLinkedCptCustomerDaySeries(options);
    return mapLinkedCptDaySeriesToOvershootLimitCappedCustomers(dayRows);
}

export async function fetchOvershootLimitCappedPeriodSummary(
    options: FetchOvershootLimitCappedPeriodOptions
): Promise<{
    rows: CustomerOvershootLimitCappedRow[];
    summary: PortfolioOvershootSummary;
    overshootRanking: CustomerOvershootLimitCappedRow[];
    limitCappedRows: CustomerOvershootLimitCappedRow[];
}> {
    const rows = await fetchOvershootLimitCappedPeriodCustomers(options);
    return {
        rows,
        summary: summarizePortfolioOvershoot(rows),
        overshootRanking: rankCustomersByOvershoot(rows),
        limitCappedRows: rows.filter((r) => r.limitCapped.limitCapped),
    };
}

export function summarizeOvershootFromLinkedCptDaySeries(
    dayRows: LinkedCptCustomerDayRow[]
): {
    rows: CustomerOvershootLimitCappedRow[];
    summary: PortfolioOvershootSummary;
    overshootRanking: CustomerOvershootLimitCappedRow[];
    limitCappedRows: CustomerOvershootLimitCappedRow[];
} {
    const rows = mapLinkedCptDaySeriesToOvershootLimitCappedCustomers(dayRows);
    return {
        rows,
        summary: summarizePortfolioOvershoot(rows),
        overshootRanking: rankCustomersByOvershoot(rows),
        limitCappedRows: rows.filter((r) => r.limitCapped.limitCapped),
    };
}

/** Customers with ≥1 limit day for the overshoot ranking report. */
export async function fetchOvershootRankingPeriodCustomers(
    options: FetchOvershootLimitCappedPeriodOptions
): Promise<CustomerOvershootLimitCappedRow[]> {
    const rows = await fetchOvershootLimitCappedPeriodCustomers(options);
    return rankCustomersByOvershoot(rows);
}

/** Customers where the limit-capped flag fired. */
export async function fetchLimitCappedPeriodCustomers(
    options: FetchOvershootLimitCappedPeriodOptions
): Promise<CustomerOvershootLimitCappedRow[]> {
    const rows = await fetchOvershootLimitCappedPeriodCustomers(options);
    return rows.filter((r) => r.limitCapped.limitCapped);
}

/**
 * Trailing-window metrics for one customer (Customer dashboard card + banner).
 */
export async function fetchCustomerTrailingOvershootLimitCappedMetrics(options: {
    accountId: number;
    customerId: number;
    policyId?: number;
    days?: number;
}): Promise<CustomerOvershootLimitCappedRow | null> {
    const days = Math.min(365, Math.max(7, options.days ?? 90));
    const toDateUtc = new Date();
    toDateUtc.setUTCHours(0, 0, 0, 0);
    const fromDateUtc = new Date(toDateUtc);
    fromDateUtc.setUTCDate(fromDateUtc.getUTCDate() - (days - 1));

    const fromDate = fromDateUtc.toISOString().slice(0, 10);
    const toDate = toDateUtc.toISOString().slice(0, 10);

    const rows = await fetchOvershootLimitCappedPeriodCustomers({
        accountId: options.accountId,
        customerId: options.customerId,
        policyId: options.policyId,
        fromDate,
        toDate,
        includeNoPolicyExposure: true,
    });
    return rows[0] ?? null;
}
