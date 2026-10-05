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
    /** Base approved limit summed for the customer×day. */
    approvedLimitSum: number;
    /** Active top-up cover summed for the customer×day. */
    topUpTotalSum: number;
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
    approved_limit_sum: number | string | null;
    top_up_total_sum: number | string | null;
    effective_usage_pct: number | string | null;
    total_receivables: number | string | null;
    compliant_exposure: number | string | null;
    person_name: string | null;
    company_name: string | null;
};

type PoolLeafRollupRawRow = {
    customer_id: number;
    snapshot_date: Date | string;
    leaf_usage_amount: number | string | null;
    leaf_total_receivables: number | string | null;
    pool_top_up_max: number | string | null;
    leaf_approved_limit_max: number | string | null;
    leaf_effective_limit_max: number | string | null;
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

function poolDayKey(customerId: number, snapshotDate: string): string {
    return `${customerId}|${snapshotDate}`;
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
 * Roots only (`parent_customer_id` null), including credit-pool shells.
 * Leaf AR / top-up on descendants is merged onto the shell day so pool
 * top-up draw still shows when cover was booked on children.
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

    const [rows, poolLeafRows] = await Promise.all([
        prisma.$queryRaw<LinkedCptCustomerDayRawRow[]>`
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
            SUM(COALESCE(t.approved_limit, 0))::float8 AS approved_limit_sum,
            SUM(COALESCE(t.top_up_total, 0))::float8 AS top_up_total_sum,
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
          AND c.parent_customer_id IS NULL
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
    `,
        prisma.$queryRaw<PoolLeafRollupRawRow[]>`
            WITH RECURSIVE pool AS (
                SELECT c.id AS root_id, c.id AS member_id
                FROM "Customer" c
                WHERE c.account_id = ${options.accountId}
                  AND c.parent_customer_id IS NULL
                  AND (
                    ${options.customerId ?? null}::int IS NULL
                    OR c.id = ${options.customerId ?? null}
                  )
                  AND (
                    ${scoped == null}::boolean
                    OR c.id = ANY(${scoped ?? []}::int[])
                  )
                UNION ALL
                SELECT pool.root_id, child.id
                FROM "Customer" child
                INNER JOIN pool ON child.parent_customer_id = pool.member_id
                WHERE child.account_id = ${options.accountId}
            )
            SELECT
                pool.root_id AS customer_id,
                t.snapshot_date,
                SUM(COALESCE(t.usage_amount, 0))::float8 AS leaf_usage_amount,
                SUM(COALESCE(t.total_receivables, 0))::float8 AS leaf_total_receivables,
                MAX(COALESCE(t.top_up_total, 0))::float8 AS pool_top_up_max,
                MAX(COALESCE(t.approved_limit, 0))::float8 AS leaf_approved_limit_max,
                MAX(
                    COALESCE(t.effective_approved_limit, t.approved_limit, 0)
                )::float8 AS leaf_effective_limit_max,
                MAX(rp.full_name) AS person_name,
                MAX(rco.name) AS company_name
            FROM pool
            INNER JOIN "Customer" root ON root.id = pool.root_id
            LEFT JOIN "Person" rp ON rp.id = root.person_id
            LEFT JOIN "Company" rco ON rco.id = root.company_id
            INNER JOIN "CustomerPolicyTrend" t
                ON t.customer_id = pool.member_id
               AND t.account_id = ${options.accountId}
            WHERE pool.member_id <> pool.root_id
              AND NOT EXISTS (
                SELECT 1
                FROM "Customer" x
                WHERE x.parent_customer_id = pool.member_id
                  AND x.account_id = ${options.accountId}
              )
              AND t.snapshot_date >= ${fromDateUtc}::date
              AND t.snapshot_date <= ${toDateUtc}::date
              AND t.insurance_policy_id IS NOT NULL
              AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
              AND (
                ${options.policyId ?? null}::int IS NULL
                OR t.insurance_policy_id = ${options.policyId ?? null}
              )
              AND (
                ${includeNoPolicy}::boolean
                OR COALESCE(t.total_receivables, 0) <= 0
                OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, '')))
                    IS DISTINCT FROM ${pendingReviewLiteral}
              )
            GROUP BY pool.root_id, t.snapshot_date
        `,
    ]);

    const poolLeafByRootDay = new Map<
        string,
        {
            usage: number;
            receivables: number;
            topUp: number;
            approvedLimit: number;
            effectiveLimit: number;
            customerName: string;
        }
    >();
    for (const row of poolLeafRows) {
        const customerId = row.customer_id;
        poolLeafByRootDay.set(
            poolDayKey(customerId, normalizeSnapshotYmd(row.snapshot_date)),
            {
                usage: Math.max(0, toNumber(row.leaf_usage_amount)),
                receivables: Math.max(0, toNumber(row.leaf_total_receivables)),
                topUp: Math.max(0, toNumber(row.pool_top_up_max)),
                approvedLimit: Math.max(0, toNumber(row.leaf_approved_limit_max)),
                effectiveLimit: Math.max(
                    0,
                    toNumber(row.leaf_effective_limit_max)
                ),
                customerName: resolveCustomerName({
                    person_name: row.person_name,
                    company_name: row.company_name,
                    customer_id: customerId,
                }),
            }
        );
    }

    const mapped = rows.map((row) => {
        const approvedRowCount = toNumber(row.approved_row_count);
        const snapshotDate = normalizeSnapshotYmd(row.snapshot_date);
        const poolLeaf = poolLeafByRootDay.get(
            poolDayKey(row.customer_id, snapshotDate)
        );
        const usageAmount = Math.max(
            toNumber(row.usage_amount),
            poolLeaf?.usage ?? 0
        );
        const totalReceivables = Math.max(
            toNumber(row.total_receivables),
            poolLeaf?.receivables ?? 0
        );
        const topUpTotalSum = Math.max(
            0,
            toNumber(row.top_up_total_sum),
            poolLeaf?.topUp ?? 0
        );
        const limitSum = Math.max(
            toNumber(row.effective_limit_sum),
            poolLeaf?.effectiveLimit ?? 0
        );
        const approvedLimitSum = Math.max(
            0,
            toNumber(row.approved_limit_sum),
            poolLeaf?.approvedLimit ?? 0
        );
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
            snapshotDate,
            customerName: resolveCustomerName(row),
            approvedDay: approvedRowCount > 0 || limitSum > 0,
            approvedCapacityGapAmount: Math.max(
                0,
                toNumber(row.approved_capacity_gap_amount)
            ),
            approvedHealthIndex: toNullableNumber(row.approved_health_index),
            approvedTotalReceivables: Math.max(
                0,
                toNumber(row.approved_total_receivables),
                poolLeaf?.receivables ?? 0
            ),
            usageAmount,
            effectiveLimitSum: limitSum,
            approvedLimitSum,
            topUpTotalSum,
            effectiveUsagePct,
            totalReceivables,
            compliantExposure: toNumber(row.compliant_exposure),
        };
    });

    const seen = new Set(
        mapped.map((row) => poolDayKey(row.customerId, row.snapshotDate))
    );
    for (const [key, poolLeaf] of poolLeafByRootDay) {
        if (seen.has(key)) {
            continue;
        }
        const sep = key.indexOf("|");
        const customerId = Number(key.slice(0, sep));
        const snapshotDate = key.slice(sep + 1);
        const limitSum = poolLeaf.effectiveLimit;
        const usageAmount = poolLeaf.usage;
        mapped.push({
            customerId,
            snapshotDate,
            customerName: poolLeaf.customerName,
            approvedDay: limitSum > 0,
            approvedCapacityGapAmount: Math.max(0, usageAmount - limitSum),
            approvedHealthIndex: null,
            approvedTotalReceivables: poolLeaf.receivables,
            usageAmount,
            effectiveLimitSum: limitSum,
            approvedLimitSum: poolLeaf.approvedLimit,
            topUpTotalSum: poolLeaf.topUp,
            effectiveUsagePct:
                limitSum > 0 ? (usageAmount / limitSum) * 100 : null,
            totalReceivables: poolLeaf.receivables,
            compliantExposure: 0,
        });
    }

    mapped.sort((a, b) => {
        if (a.customerId !== b.customerId) {
            return a.customerId - b.customerId;
        }
        return a.snapshotDate.localeCompare(b.snapshotDate);
    });
    return mapped;
}
