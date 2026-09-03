/**
 * As-of CustomerPolicyTrend cohort for utilization-bin credit dashboard drills.
 * Same eligibility as portfolio-health distribution (approved + positive effective limit).
 */

import { prisma } from "../domain-db";
import {
    assignUtilizationDistributionBin,
    isUtilizationDistributionBinKey,
    type UtilizationDistributionBinKey,
} from "./utilizationDistributionBins";

export type UtilizationBinCustomerRow = {
    customerId: number;
    customerName: string;
    policyNumber: string | null;
    utilizationPct: number;
    usageAmount: number;
    effectiveLimit: number;
};

type CptBinRawRow = {
    customer_id: number;
    usage_amount: number | string | null;
    utilization_pct: number | string | null;
    effective_limit: number | string | null;
    policy_number: string | null;
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

function resolveCustomerName(row: CptBinRawRow): string {
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

export async function fetchUtilizationBinCptCustomers(options: {
    accountId: number;
    bin: UtilizationDistributionBinKey;
    asOfDate: string;
    policyId?: number;
    customerId?: number;
    includeNoPolicyExposure?: boolean;
}): Promise<UtilizationBinCustomerRow[]> {
    if (!isUtilizationDistributionBinKey(options.bin)) {
        return [];
    }
    const asOfDateUtc = startOfUtcDayFromYmd(options.asOfDate);
    if (asOfDateUtc == null) {
        return [];
    }

    const pendingReviewLiteral = "pending review";
    const includeNoPolicy = options.includeNoPolicyExposure !== false;

    const rows = await prisma.$queryRaw<CptBinRawRow[]>`
        SELECT
            t.customer_id,
            COALESCE(t.usage_amount, 0)::float8 AS usage_amount,
            CASE
                WHEN t.effective_usage_pct IS NOT NULL THEN t.effective_usage_pct
                ELSE (t.usage_amount / COALESCE(t.effective_approved_limit, t.approved_limit, 0)::float8) * 100
            END AS utilization_pct,
            COALESCE(t.effective_approved_limit, t.approved_limit, 0)::float8 AS effective_limit,
            ip.policy_number,
            p.full_name AS person_name,
            co.name AS company_name
        FROM "CustomerPolicyTrend" t
        INNER JOIN "Customer" c ON c.id = t.customer_id
        LEFT JOIN "Person" p ON p.id = c.person_id
        LEFT JOIN "Company" co ON co.id = c.company_id
        LEFT JOIN "InsurancePolicy" ip ON ip.id = t.insurance_policy_id
        WHERE t.account_id = ${options.accountId}
          AND t.snapshot_date = ${asOfDateUtc}::date
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
            ${includeNoPolicy}::boolean
            OR COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
    `;

    return rows
        .map((row) => {
            const utilizationPct = toNumber(row.utilization_pct);
            return {
                customerId: row.customer_id,
                customerName: resolveCustomerName(row),
                policyNumber: row.policy_number,
                utilizationPct,
                usageAmount: toNumber(row.usage_amount),
                effectiveLimit: toNumber(row.effective_limit),
                bin: assignUtilizationDistributionBin(utilizationPct),
            };
        })
        .filter((row) => row.bin === options.bin)
        .map(({ bin: _bin, ...rest }) => rest);
}

export async function fetchAsOfUtilizationByCustomerIds(options: {
    accountId: number;
    asOfDate: string;
    customerIds: number[];
    policyId?: number;
}): Promise<
    Map<number, { utilizationPct: number; usageAmount: number }>
> {
    const map = new Map<
        number,
        { utilizationPct: number; usageAmount: number }
    >();
    if (options.customerIds.length === 0) {
        return map;
    }
    const asOfDateUtc = startOfUtcDayFromYmd(options.asOfDate);
    if (asOfDateUtc == null) {
        return map;
    }

    const rows = await prisma.$queryRaw<
        Array<{
            customer_id: number;
            usage_amount: number | string | null;
            utilization_pct: number | string | null;
        }>
    >`
        SELECT
            t.customer_id,
            COALESCE(t.usage_amount, 0)::float8 AS usage_amount,
            CASE
                WHEN t.effective_usage_pct IS NOT NULL THEN t.effective_usage_pct
                ELSE (t.usage_amount / COALESCE(t.effective_approved_limit, t.approved_limit, 0)::float8) * 100
            END AS utilization_pct
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${options.accountId}
          AND t.snapshot_date = ${asOfDateUtc}::date
          AND t.customer_id = ANY(${options.customerIds}::int[])
          AND (
            ${options.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options.policyId ?? null}
          )
          AND t.insurance_policy_id IS NOT NULL
          AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
          AND COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
    `;

    for (const row of rows) {
        // Prefer first matching approved row per customer (stable).
        if (map.has(row.customer_id)) {
            continue;
        }
        map.set(row.customer_id, {
            utilizationPct: toNumber(row.utilization_pct),
            usageAmount: toNumber(row.usage_amount),
        });
    }
    return map;
}
