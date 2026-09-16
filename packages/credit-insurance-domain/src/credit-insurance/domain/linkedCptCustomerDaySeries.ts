/**
 * Shared Customer×Policy Trend (CTP) day series for Portfolio Health Bucket 1
 * KPIs that share the same linked/approved cohort filter (capacity gap, health
 * slope / AR volatility, utilization overshoot / limit-capped).
 *
 * One SQL scan; callers derive KPI-specific customer metrics in memory.
 * Conditional aggregates preserve capacity/stale “positive limit” day semantics
 * while still returning zero-limit days for overshoot / limit-capped.
 */

import { prisma } from "../domain-db";

export type FetchLinkedCptCustomerDaySeriesOptions = {
    accountId: number;
    fromDate: string;
    toDate: string;
    policyId?: number;
    customerId?: number;
    scopedCustomerIds?: number[] | null;
    includeNoPolicyExposure?: boolean;
};

export type LinkedCptCustomerDayRow = {
    customerId: number;
    snapshotDate: string;
    customerName: string;
    /** True when ≥1 linked row that day had a positive effective limit. */
    approvedDay: boolean;
    /** Capacity gap summed only over positive-limit rows. */
    approvedCapacityGapAmount: number;
    /** Mean health index over positive-limit rows; null when none. */
    approvedHealthIndex: number | null;
    /** Open AR summed only over positive-limit rows. */
    approvedTotalReceivables: number;
    usageAmount: number;
    effectiveLimitSum: number;
    /** Size-weighted util when limit > 0; else null. */
    effectiveUsagePct: number | null;
    totalReceivables: number;
    compliantExposure: number;
};

type LinkedCptCustomerDayRawRow = {
    customer_id: number;
    snapshot_date: Date | string;
    approved_row_count: number | string | null;
    approved_capacity_gap_amount: number | string | null;
    approved_health_index: number | string | null;
    approved_total_receivables: number | string | null;
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

/**
 * Linked, non-excluded CTP rows in range, aggregated per customer × day.
 */
export async function fetchLinkedCptCustomerDaySeries(
    options: FetchLinkedCptCustomerDaySeriesOptions
): Promise<LinkedCptCustomerDayRow[]> {
    const fromDateUtc = startOfUtcDayFromYmd(options.fromDate);
    const toDateUtc = startOfUtcDayFromYmd(options.toDate);
    if (fromDateUtc == null || toDateUtc == null) {
        return [];
    }

    const pendingReviewLiteral = "pending review";
    const includeNoPolicy = options.includeNoPolicyExposure !== false;
    const scoped = options.scopedCustomerIds ?? null;

    const rows = await prisma.$queryRaw<LinkedCptCustomerDayRawRow[]>`
        SELECT
            t.customer_id,
            t.snapshot_date,
            COUNT(*) FILTER (
                WHERE COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
            )::float8 AS approved_row_count,
            SUM(
                CASE
                    WHEN COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
                    THEN COALESCE(t.capacity_gap_amount, 0)
                    ELSE 0
                END
            )::float8 AS approved_capacity_gap_amount,
            AVG(
                CASE
                    WHEN COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
                    THEN COALESCE(t.health_index, 0)
                    ELSE NULL
                END
            )::float8 AS approved_health_index,
            SUM(
                CASE
                    WHEN COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
                    THEN COALESCE(t.total_receivables, 0)
                    ELSE 0
                END
            )::float8 AS approved_total_receivables,
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

    return rows.map((row) => {
        const approvedRowCount = toNumber(row.approved_row_count);
        const limitSum = toNumber(row.effective_limit_sum);
        const usageAmount = toNumber(row.usage_amount);
        let effectiveUsagePct: number | null = null;
        if (limitSum > 0) {
            effectiveUsagePct = (usageAmount / limitSum) * 100;
            const avgPct = toNullableNumber(row.effective_usage_pct);
            if (avgPct != null && !Number.isFinite(effectiveUsagePct)) {
                effectiveUsagePct = avgPct;
            }
        }
        return {
            customerId: row.customer_id,
            snapshotDate: normalizeSnapshotYmd(row.snapshot_date),
            customerName: resolveCustomerName(row),
            approvedDay: approvedRowCount > 0,
            approvedCapacityGapAmount: Math.max(
                0,
                toNumber(row.approved_capacity_gap_amount)
            ),
            approvedHealthIndex: toNullableNumber(row.approved_health_index),
            approvedTotalReceivables: Math.max(
                0,
                toNumber(row.approved_total_receivables)
            ),
            usageAmount,
            effectiveLimitSum: limitSum,
            effectiveUsagePct,
            totalReceivables: toNumber(row.total_receivables),
            compliantExposure: toNumber(row.compliant_exposure),
        };
    });
}
