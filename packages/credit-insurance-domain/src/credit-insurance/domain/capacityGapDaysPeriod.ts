/**
 * Period CTP cohort for chronic over-limit Portfolio Health roll-ups and
 * customer trailing status. Includes approved customers with available days
 * even when never over limit.
 */

import { prisma } from "../domain-db";
import {
    computeCustomerOverLimitGapMetrics,
    summarizePortfolioOverLimitGap,
    type CustomerOverLimitGapRow,
    type PortfolioOverLimitGapSummary,
} from "./shared/ctpOverLimitGapMetrics";

type CptGapRawRow = {
    customer_id: number;
    snapshot_date: Date | string;
    capacity_gap_amount: number | string | null;
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

export type FetchCapacityGapDaysPeriodOptions = {
    accountId: number;
    fromDate: string;
    toDate: string;
    policyId?: number;
    customerId?: number;
    scopedCustomerIds?: number[] | null;
    includeNoPolicyExposure?: boolean;
};

/**
 * Approved CTP rows in range (linked policy, not excluded, positive effective
 * limit), aggregated per customer with over-limit metrics.
 */
export async function fetchCapacityGapDaysPeriodCustomers(
    options: FetchCapacityGapDaysPeriodOptions
): Promise<CustomerOverLimitGapRow[]> {
    const fromDateUtc = startOfUtcDayFromYmd(options.fromDate);
    const toDateUtc = startOfUtcDayFromYmd(options.toDate);
    if (fromDateUtc == null || toDateUtc == null) {
        return [];
    }

    const pendingReviewLiteral = "pending review";
    const includeNoPolicy = options.includeNoPolicyExposure !== false;
    const scoped = options.scopedCustomerIds ?? null;

    const rows = await prisma.$queryRaw<CptGapRawRow[]>`
        SELECT
            t.customer_id,
            t.snapshot_date,
            SUM(COALESCE(t.capacity_gap_amount, 0))::float8 AS capacity_gap_amount,
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
            points: Array<{ snapshotDate: string; capacityGapAmount: number }>;
        }
    >();

    for (const row of rows) {
        const customerId = row.customer_id;
        let entry = byCustomer.get(customerId);
        if (!entry) {
            entry = {
                customerName: resolveCustomerName(row),
                points: [],
            };
            byCustomer.set(customerId, entry);
        }
        entry.points.push({
            snapshotDate: normalizeSnapshotYmd(row.snapshot_date),
            capacityGapAmount: Math.max(0, toNumber(row.capacity_gap_amount)),
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
