/**
 * Period CTP cohort for health slope, AR volatility, and stale snapshot KPIs
 * (Bucket 1 #5 / #6 / #7). Same approved-customer filter as capacity-gap-days.
 */

import { detectStaleArRuns } from "./shared/ctpDailySeries";
import {
    computeCustomerHealthSlopeVolatilityMetrics,
    computeHealthMomentum,
    type CustomerHealthSlopeVolatilityMetrics,
    type HealthMomentumClassification,
} from "./shared/ctpHealthSlopeVolatility";
import {
    fetchLinkedCptCustomerDaySeries,
    type FetchLinkedCptCustomerDaySeriesOptions,
    type LinkedCptCustomerDayRow,
} from "./linkedCptCustomerDaySeries";

export type FetchStaleSlopeVolatilityPeriodOptions =
    FetchLinkedCptCustomerDaySeriesOptions & {
        /**
         * When set, health slope uses only the last N non-stale available days
         * (Customer dashboard default: 30). Peak/current still use the full series.
         */
        healthTrailingDays?: number;
    };

export type CustomerStaleSlopeVolatilityRow =
    CustomerHealthSlopeVolatilityMetrics & {
        customerId: number;
        customerName: string;
        daysAvailable: number;
        extremeMoveCount: number;
        worstExtremePctChange: number | null;
        worstExtremeDate: string | null;
    };

export type PortfolioStaleSlopeVolatilitySummary = {
    /** Sum of per-customer carried-forward (stale) snapshot days. */
    staleCarriedForwardDayCount: number;
    customersWithStaleDays: number;
    customersWithExtremeMoves: number;
    customersWithData: number;
    /**
     * Portfolio-level health momentum from aggregated daily portfolio health
     * (caller supplies series). Placeholder nulls when not attached.
     */
    portfolioHealthSlope: number | null;
    portfolioHealthClassification: HealthMomentumClassification | null;
    portfolioHealthSlopeSuppressed: boolean;
    portfolioHealthDaysUsed: number;
    portfolioPeakHealth: number | null;
    portfolioPeakDate: string | null;
    portfolioCurrentHealth: number | null;
    portfolioCurrentDate: string | null;
    /** Mean of per-customer σ (eligible customers with a sigma); null if none. */
    avgCustomerArSigmaPct: number | null;
};

function emptyPortfolioSummary(): PortfolioStaleSlopeVolatilitySummary {
    return {
        staleCarriedForwardDayCount: 0,
        customersWithStaleDays: 0,
        customersWithExtremeMoves: 0,
        customersWithData: 0,
        portfolioHealthSlope: null,
        portfolioHealthClassification: null,
        portfolioHealthSlopeSuppressed: true,
        portfolioHealthDaysUsed: 0,
        portfolioPeakHealth: null,
        portfolioPeakDate: null,
        portfolioCurrentHealth: null,
        portfolioCurrentDate: null,
        avgCustomerArSigmaPct: null,
    };
}

/**
 * Build stale / slope / volatility customer rows from a shared linked CPT day
 * series. Only positive-limit (approved) days are included.
 */
export function mapLinkedCptDaySeriesToStaleSlopeVolatilityCustomers(
    dayRows: LinkedCptCustomerDayRow[],
    options?: { healthTrailingDays?: number }
): CustomerStaleSlopeVolatilityRow[] {
    const byCustomer = new Map<
        number,
        {
            customerName: string;
            healthPoints: Array<{ snapshotDate: string; value: number }>;
            arPoints: Array<{ snapshotDate: string; totalReceivables: number }>;
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
                healthPoints: [],
                arPoints: [],
            };
            byCustomer.set(row.customerId, entry);
        }
        entry.healthPoints.push({
            snapshotDate: row.snapshotDate,
            value: row.approvedHealthIndex ?? 0,
        });
        entry.arPoints.push({
            snapshotDate: row.snapshotDate,
            totalReceivables: row.approvedTotalReceivables,
        });
    }

    const result: CustomerStaleSlopeVolatilityRow[] = [];
    for (const [customerId, entry] of byCustomer) {
        const metrics = computeCustomerHealthSlopeVolatilityMetrics({
            healthPoints: entry.healthPoints,
            arPoints: entry.arPoints,
            healthOptions:
                options?.healthTrailingDays != null
                    ? { trailingDays: options.healthTrailingDays }
                    : undefined,
        });
        const extreme = metrics.arVolatility.extremeMoves;
        let worstExtremePctChange: number | null = null;
        let worstExtremeDate: string | null = null;
        for (const move of extreme) {
            if (
                worstExtremePctChange == null ||
                Math.abs(move.pctChange) > Math.abs(worstExtremePctChange)
            ) {
                worstExtremePctChange = move.pctChange;
                worstExtremeDate = move.snapshotDate;
            }
        }
        result.push({
            customerId,
            customerName: entry.customerName,
            daysAvailable: entry.arPoints.length,
            extremeMoveCount: extreme.length,
            worstExtremePctChange,
            worstExtremeDate,
            ...metrics,
        });
    }
    return result;
}

/**
 * Approved CTP rows in range with health + AR for slope / volatility / stale.
 */
export async function fetchStaleSlopeVolatilityPeriodCustomers(
    options: FetchStaleSlopeVolatilityPeriodOptions
): Promise<CustomerStaleSlopeVolatilityRow[]> {
    const dayRows = await fetchLinkedCptCustomerDaySeries(options);
    return mapLinkedCptDaySeriesToStaleSlopeVolatilityCustomers(dayRows, {
        healthTrailingDays: options.healthTrailingDays,
    });
}

export function summarizePortfolioStaleSlopeVolatility(
    rows: CustomerStaleSlopeVolatilityRow[],
    portfolioDaily?: Array<{
        snapshotDate: string;
        healthIndex: number;
        totalReceivables: number;
    }>
): PortfolioStaleSlopeVolatilitySummary {
    const withData = rows.filter((r) => r.daysAvailable > 0);
    if (withData.length === 0 && (portfolioDaily == null || portfolioDaily.length === 0)) {
        return emptyPortfolioSummary();
    }

    const staleCarriedForwardDayCount = withData.reduce(
        (sum, r) => sum + r.staleDayCount,
        0
    );
    const customersWithStaleDays = withData.filter(
        (r) => r.staleDayCount > 0
    ).length;
    const customersWithExtremeMoves = withData.filter(
        (r) => r.extremeMoveCount > 0
    ).length;

    const sigmaRows = withData.filter((r) => r.arVolatility.sigmaPct != null);
    const avgCustomerArSigmaPct =
        sigmaRows.length > 0
            ? sigmaRows.reduce(
                  (sum, r) => sum + (r.arVolatility.sigmaPct ?? 0),
                  0
              ) / sigmaRows.length
            : null;

    let portfolioHealthSlope: number | null = null;
    let portfolioHealthClassification: HealthMomentumClassification | null =
        null;
    let portfolioHealthSlopeSuppressed = true;
    let portfolioHealthDaysUsed = 0;
    let portfolioPeakHealth: number | null = null;
    let portfolioPeakDate: string | null = null;
    let portfolioCurrentHealth: number | null = null;
    let portfolioCurrentDate: string | null = null;

    if (portfolioDaily != null && portfolioDaily.length > 0) {
        const arPoints = portfolioDaily.map((d) => ({
            snapshotDate: d.snapshotDate,
            totalReceivables: d.totalReceivables,
        }));
        const stale = detectStaleArRuns(arPoints);
        const momentum = computeHealthMomentum(
            portfolioDaily.map((d) => ({
                snapshotDate: d.snapshotDate,
                value: d.healthIndex,
            })),
            { excludeDates: stale.excludeSet }
        );
        portfolioHealthSlope = momentum.slope;
        portfolioHealthClassification = momentum.classification;
        portfolioHealthSlopeSuppressed = momentum.suppressed;
        portfolioHealthDaysUsed = momentum.daysUsed;
        portfolioPeakHealth = momentum.peakHealth;
        portfolioPeakDate = momentum.peakDate;
        portfolioCurrentHealth = momentum.currentHealth;
        portfolioCurrentDate = momentum.currentDate;
    }

    return {
        staleCarriedForwardDayCount,
        customersWithStaleDays,
        customersWithExtremeMoves,
        customersWithData: withData.length,
        portfolioHealthSlope,
        portfolioHealthClassification,
        portfolioHealthSlopeSuppressed,
        portfolioHealthDaysUsed,
        portfolioPeakHealth,
        portfolioPeakDate,
        portfolioCurrentHealth,
        portfolioCurrentDate,
        avgCustomerArSigmaPct,
    };
}

export async function fetchStaleSlopeVolatilityPeriodSummary(
    options: FetchStaleSlopeVolatilityPeriodOptions,
    portfolioDaily?: Array<{
        snapshotDate: string;
        healthIndex: number;
        totalReceivables: number;
    }>
): Promise<{
    rows: CustomerStaleSlopeVolatilityRow[];
    summary: PortfolioStaleSlopeVolatilitySummary;
}> {
    const rows = await fetchStaleSlopeVolatilityPeriodCustomers(options);
    return {
        rows,
        summary: summarizePortfolioStaleSlopeVolatility(rows, portfolioDaily),
    };
}

/**
 * Trailing-window metrics for one customer (Customer dashboard).
 */
export async function fetchCustomerTrailingStaleSlopeVolatilityMetrics(options: {
    accountId: number;
    customerId: number;
    policyId?: number;
    days?: number;
}): Promise<CustomerStaleSlopeVolatilityRow | null> {
    const days = Math.min(365, Math.max(7, options.days ?? 90));
    const toDateUtc = new Date();
    toDateUtc.setUTCHours(0, 0, 0, 0);
    const fromDateUtc = new Date(toDateUtc);
    fromDateUtc.setUTCDate(fromDateUtc.getUTCDate() - (days - 1));

    const fromDate = fromDateUtc.toISOString().slice(0, 10);
    const toDate = toDateUtc.toISOString().slice(0, 10);

    const rows = await fetchStaleSlopeVolatilityPeriodCustomers({
        accountId: options.accountId,
        customerId: options.customerId,
        policyId: options.policyId,
        fromDate,
        toDate,
        includeNoPolicyExposure: true,
        healthTrailingDays: 30,
    });
    return rows[0] ?? null;
}

/** Customers with at least one extreme DoD AR move (report membership). */
export async function fetchArExtremeMovesPeriodCustomers(
    options: FetchStaleSlopeVolatilityPeriodOptions
): Promise<CustomerStaleSlopeVolatilityRow[]> {
    const rows = await fetchStaleSlopeVolatilityPeriodCustomers(options);
    return rows.filter((r) => r.extremeMoveCount > 0);
}
