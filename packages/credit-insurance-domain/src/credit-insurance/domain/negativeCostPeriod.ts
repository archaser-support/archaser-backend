/**
 * Period CTP cohort for anomalous negative daily-cost visibility (KPI #8).
 */

import { prisma } from "../domain-db";
import {
    NEGATIVE_COST_MIN_MAGNITUDE,
    collectNegativeCostEntries,
    summarizeCustomerNegativeCosts,
    summarizePortfolioNegativeCosts,
    type CustomerNegativeCostSummary,
    type NegativeCostFlaggedEntry,
    type NegativeCostThresholds,
    type PortfolioNegativeCostSummary,
} from "./shared/ctpNegativeCostMetrics";

type CptNegativeCostRawRow = {
    customer_id: number;
    snapshot_date: Date | string;
    policy_daily_cost: number | string | null;
    total_daily_cost: number | string | null;
    person_name: string | null;
    company_name: string | null;
};

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

export type FetchNegativeCostPeriodOptions = {
    accountId: number;
    fromDate: string;
    toDate: string;
    policyId?: number;
    customerId?: number;
    scopedCustomerIds?: number[] | null;
    includeNoPolicyExposure?: boolean;
    thresholds?: NegativeCostThresholds;
    /** Cap preview entries returned with the portfolio summary (default 50). */
    previewLimit?: number;
};

export type NegativeCostPeriodResult = {
    summary: PortfolioNegativeCostSummary;
    entries: NegativeCostFlaggedEntry[];
    previewEntries: NegativeCostFlaggedEntry[];
    customers: CustomerNegativeCostSummary[];
};

async function fetchNegativeCostRawRows(
    options: FetchNegativeCostPeriodOptions
): Promise<CptNegativeCostRawRow[]> {
    const fromDateUtc = startOfUtcDayFromYmd(options.fromDate);
    const toDateUtc = startOfUtcDayFromYmd(options.toDate);
    if (fromDateUtc == null || toDateUtc == null) {
        return [];
    }

    const pendingReviewLiteral = "pending review";
    const includeNoPolicy = options.includeNoPolicyExposure !== false;
    const scoped = options.scopedCustomerIds ?? null;

    return prisma.$queryRaw<CptNegativeCostRawRow[]>`
        SELECT
            t.customer_id,
            t.snapshot_date,
            t.policy_daily_cost::float8 AS policy_daily_cost,
            t.total_daily_cost::float8 AS total_daily_cost,
            MAX(p.full_name) AS person_name,
            MAX(co.name) AS company_name
        FROM "CustomerPolicyTrend" t
        INNER JOIN "Customer" c ON c.id = t.customer_id
        LEFT JOIN "Person" p ON p.id = c.person_id
        LEFT JOIN "Company" co ON co.id = c.company_id
        WHERE t.account_id = ${options.accountId}
          AND t.snapshot_date >= ${fromDateUtc}::date
          AND t.snapshot_date <= ${toDateUtc}::date
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
            OR NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
            OR LOWER(TRIM(t.policy_exclusion_reason)) <> ${pendingReviewLiteral}
            OR COALESCE(t.total_receivables, 0) <= 0
          )
          AND (
            (t.policy_daily_cost IS NOT NULL AND t.policy_daily_cost < 0)
            OR (t.total_daily_cost IS NOT NULL AND t.total_daily_cost < 0)
          )
        GROUP BY
            t.customer_id,
            t.snapshot_date,
            t.insurance_policy_id,
            t.policy_daily_cost,
            t.total_daily_cost
    `;
}

function emptyResult(
    thresholds?: NegativeCostThresholds
): NegativeCostPeriodResult {
    return {
        summary: {
            negativeEntryCount: 0,
            negativeEntrySum: 0,
            customersAffected: 0,
            minMagnitude:
                thresholds?.minMagnitude ?? NEGATIVE_COST_MIN_MAGNITUDE,
        },
        entries: [],
        previewEntries: [],
        customers: [],
    };
}

export async function fetchNegativeCostPeriod(
    options: FetchNegativeCostPeriodOptions
): Promise<NegativeCostPeriodResult> {
    const raw = await fetchNegativeCostRawRows(options);
    if (raw.length === 0) {
        return emptyResult(options.thresholds);
    }

    const entries = collectNegativeCostEntries(
        raw.map((row) => ({
            customerId: row.customer_id,
            customerName: resolveCustomerName(row),
            snapshotDate: normalizeSnapshotYmd(row.snapshot_date),
            policyDailyCost: toNullableNumber(row.policy_daily_cost),
            totalDailyCost: toNullableNumber(row.total_daily_cost),
        })),
        options.thresholds
    );

    const previewLimit =
        options.previewLimit != null && options.previewLimit > 0
            ? options.previewLimit
            : 50;

    return {
        summary: summarizePortfolioNegativeCosts(entries, options.thresholds),
        entries,
        previewEntries: entries.slice(0, previewLimit),
        customers: summarizeCustomerNegativeCosts(entries),
    };
}

/** Customers with at least one flagged negative cost entry (report membership). */
export async function fetchNegativeCostPeriodCustomers(
    options: FetchNegativeCostPeriodOptions
): Promise<CustomerNegativeCostSummary[]> {
    const result = await fetchNegativeCostPeriod(options);
    return result.customers;
}

export async function fetchNegativeCostPeriodSummary(
    options: FetchNegativeCostPeriodOptions
): Promise<NegativeCostPeriodResult> {
    return fetchNegativeCostPeriod(options);
}
