/**
 * Period CTP cohort for utilization overshoot (KPI #2) and limit-capped
 * detection (KPI #3). Approved customers with a positive effective limit on
 * at least one day; null-limit-only customers are excluded from overshoot.
 */

import { prisma } from "../domain-db";
import {
    computeCustomerOvershootLimitCappedMetrics,
    rankCustomersByOvershoot,
    summarizePortfolioOvershoot,
    type CustomerOvershootLimitCappedRow,
    type PortfolioOvershootSummary,
} from "./shared/ctpOvershootLimitCappedMetrics";

type CptOvershootRawRow = {
    customer_id: number;
    snapshot_date: Date | string;
    usage_amount: number | string | null;
    effective_limit_sum: number | string | null;
    effective_usage_pct: number | string | null;
    total_receivables: number | string | null;
    compliant_exposure: number | string | null;
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

function toNullableNumber(
    value: number | string | null | undefined
): number | null {
    if (value == null) {
        return null;
    }
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
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

export type FetchOvershootLimitCappedPeriodOptions = {
    accountId: number;
    fromDate: string;
    toDate: string;
    policyId?: number;
    customerId?: number;
    scopedCustomerIds?: number[] | null;
    includeNoPolicyExposure?: boolean;
};

/**
 * Approved CTP rows in range. Utilization % is size-weighted when multiple
 * policies share a day (usage ÷ effective limit). Days with no positive
 * effective limit contribute AR/compliant for limit-capped but null util for
 * overshoot exclusion.
 */
export async function fetchOvershootLimitCappedPeriodCustomers(
    options: FetchOvershootLimitCappedPeriodOptions
): Promise<CustomerOvershootLimitCappedRow[]> {
    const fromDateUtc = startOfUtcDayFromYmd(options.fromDate);
    const toDateUtc = startOfUtcDayFromYmd(options.toDate);
    if (fromDateUtc == null || toDateUtc == null) {
        return [];
    }

    const pendingReviewLiteral = "pending review";
    const includeNoPolicy = options.includeNoPolicyExposure !== false;
    const scoped = options.scopedCustomerIds ?? null;

    const rows = await prisma.$queryRaw<CptOvershootRawRow[]>`
        SELECT
            t.customer_id,
            t.snapshot_date,
            SUM(COALESCE(t.usage_amount, 0))::float8 AS usage_amount,
            SUM(
                COALESCE(t.effective_approved_limit, t.approved_limit, 0)
            )::float8 AS effective_limit_sum,
            AVG(
                CASE
                    WHEN COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
                    THEN COALESCE(
                        t.effective_usage_pct,
                        (COALESCE(t.usage_amount, 0)
                            / COALESCE(t.effective_approved_limit, t.approved_limit, 0)::float8)
                            * 100
                    )
                    ELSE NULL
                END
            )::float8 AS effective_usage_pct,
            SUM(COALESCE(t.total_receivables, 0))::float8 AS total_receivables,
            SUM(COALESCE(t.compliant_exposure, 0))::float8 AS compliant_exposure,
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

    for (const row of rows) {
        const customerId = row.customer_id;
        let entry = byCustomer.get(customerId);
        if (!entry) {
            entry = {
                customerName: resolveCustomerName(row),
                utilizationPoints: [],
                limitCappedPoints: [],
            };
            byCustomer.set(customerId, entry);
        }
        const snapshotDate = normalizeSnapshotYmd(row.snapshot_date);
        const limitSum = toNumber(row.effective_limit_sum);
        const usageAmount = toNumber(row.usage_amount);
        let utilizationPct: number | null = null;
        if (limitSum > 0) {
            // Prefer size-weighted day util when limits sum; fall back to AVG pct.
            utilizationPct = (usageAmount / limitSum) * 100;
            const avgPct = toNullableNumber(row.effective_usage_pct);
            if (avgPct != null && !Number.isFinite(utilizationPct)) {
                utilizationPct = avgPct;
            }
        }
        entry.utilizationPoints.push({ snapshotDate, utilizationPct });
        entry.limitCappedPoints.push({
            snapshotDate,
            totalReceivables: toNumber(row.total_receivables),
            compliantExposure: toNumber(row.compliant_exposure),
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
