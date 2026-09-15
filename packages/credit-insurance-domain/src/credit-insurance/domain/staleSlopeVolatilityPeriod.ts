/**
 * Period CTP cohort for health slope, AR volatility, and stale snapshot KPIs
 * (Bucket 1 #5 / #6 / #7). Same approved-customer filter as capacity-gap-days.
 */

import { prisma } from "../domain-db";
import { detectStaleArRuns } from "./shared/ctpDailySeries";
import {
    computeCustomerHealthSlopeVolatilityMetrics,
    computeHealthMomentum,
    type CustomerHealthSlopeVolatilityMetrics,
    type HealthMomentumClassification,
} from "./shared/ctpHealthSlopeVolatility";

type CptSlopeVolRawRow = {
    customer_id: number;
    snapshot_date: Date | string;
    health_index: number | string | null;
    total_receivables: number | string | null;
    person_name: string | null;
    company_name: string | null;
};

function toNumber(value: number | string | null | undefined): number {
    if (value == null) {
        return 0;
    }
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}

function startOfUtcDayFromYmd(ymd: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        return null;
    }
    const date = new Date(`${ymd}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeSnapshotYmd(value: Date | string): string {
    if (typeof value === "string") {
        return value.slice(0, 10);
    }
    return value.toISOString().slice(0, 10);
}

function resolveCustomerName(row: {
    person_name: string | null;
    company_name: string | null;
    customer_id: number;
}): string {
    const person = row.person_name?.trim();
    if (person) {
        return person;
    }
    const company = row.company_name?.trim();
    if (company) {
        return company;
    }
    return String(row.customer_id);
}

export type FetchStaleSlopeVolatilityPeriodOptions = {
    accountId: number;
    fromDate: string;
    toDate: string;
    policyId?: number;
    customerId?: number;
    scopedCustomerIds?: number[] | null;
    includeNoPolicyExposure?: boolean;
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
 * Approved CTP rows in range with health + AR for slope / volatility / stale.
 */
export async function fetchStaleSlopeVolatilityPeriodCustomers(
    options: FetchStaleSlopeVolatilityPeriodOptions
): Promise<CustomerStaleSlopeVolatilityRow[]> {
    const fromDateUtc = startOfUtcDayFromYmd(options.fromDate);
    const toDateUtc = startOfUtcDayFromYmd(options.toDate);
    if (fromDateUtc == null || toDateUtc == null) {
        return [];
    }

    const pendingReviewLiteral = "pending review";
    const includeNoPolicy = options.includeNoPolicyExposure !== false;
    const scoped = options.scopedCustomerIds ?? null;

    const rows = await prisma.$queryRaw<CptSlopeVolRawRow[]>`
        SELECT
            t.customer_id,
            t.snapshot_date,
            AVG(COALESCE(t.health_index, 0))::float8 AS health_index,
            SUM(COALESCE(t.total_receivables, 0))::float8 AS total_receivables,
            MAX(p.full_name) AS person_name,
            MAX(co.name) AS company_name
        FROM "CustomerPolicyTrend" t
        INNER JOIN "Customer" c ON c.id = t.customer_id
        LEFT JOIN "Person" p ON p.id = c.person_id
        LEFT JOIN "Company" co ON co.id = c.company_id
        WHERE t.account_id = ${options.accountId}
          AND t.snapshot_date >= ${fromDateUtc}::date
          AND t.snapshot_date <= ${toDateUtc}::date
          AND t.insurance_policy_id IS NOT NULL
          AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
          AND COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
          AND (
            ${options.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options.policyId ?? null}
          )
          AND (
            ${options.customerId ?? null}::int IS NULL
            OR t.customer_id = ${options.customerId ?? null}
          )
          AND (
            ${scoped == null}::boolean
            OR t.customer_id = ANY(${scoped ?? []}::int[])
          )
          AND (
            ${includeNoPolicy}::boolean
            OR COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
        GROUP BY t.customer_id, t.snapshot_date
        ORDER BY t.customer_id ASC, t.snapshot_date ASC
    `;

    const byCustomer = new Map<
        number,
        {
            customerName: string;
            healthPoints: Array<{ snapshotDate: string; value: number }>;
            arPoints: Array<{ snapshotDate: string; totalReceivables: number }>;
        }
    >();

    for (const row of rows) {
        const customerId = row.customer_id;
        let entry = byCustomer.get(customerId);
        if (!entry) {
            entry = {
                customerName: resolveCustomerName(row),
                healthPoints: [],
                arPoints: [],
            };
            byCustomer.set(customerId, entry);
        }
        const snapshotDate = normalizeSnapshotYmd(row.snapshot_date);
        entry.healthPoints.push({
            snapshotDate,
            value: toNumber(row.health_index),
        });
        entry.arPoints.push({
            snapshotDate,
            totalReceivables: Math.max(0, toNumber(row.total_receivables)),
        });
    }

    const result: CustomerStaleSlopeVolatilityRow[] = [];
    for (const [customerId, entry] of byCustomer) {
        const metrics = computeCustomerHealthSlopeVolatilityMetrics({
            healthPoints: entry.healthPoints,
            arPoints: entry.arPoints,
            healthOptions:
                options.healthTrailingDays != null
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
