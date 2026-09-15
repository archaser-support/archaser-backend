/**
 * Period loaders for limit-breach forecast (KPI #10).
 * Trailing available-day usage % series → projected 150%/200% crossings.
 */

import { prisma } from "../domain-db";
import {
    LIMIT_BREACH_FORECAST_TRAILING_DAYS,
    computeLimitBreachForecast,
    hasProjectedLimitBreach,
    type LimitBreachForecastResult,
} from "./shared/ctpLimitBreachForecastMetrics";

type CptUsageRawRow = {
    customer_id: number;
    snapshot_date: Date | string;
    usage_amount: number | string | null;
    effective_limit_sum: number | string | null;
    person_name: string | null;
    company_name: string | null;
    policy_number: string | null;
};

export type CustomerLimitBreachForecastRow = LimitBreachForecastResult & {
    customerId: number;
    customerName: string;
    policyNumber: string | null;
};

export type FetchLimitBreachForecastOptions = {
    accountId: number;
    /** Inclusive end of trailing window (YYYY-MM-DD). Default: today UTC. */
    toDate?: string;
    /** Override trailing length (available days). Default 30. */
    trailingDays?: number;
    policyId?: number;
    customerId?: number;
    scopedCustomerIds?: number[] | null;
    includeNoPolicyExposure?: boolean;
    /** When true, only customers with a projected crossing. */
    projectedOnly?: boolean;
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

function resolveToDateYmd(toDate?: string): string {
    if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
        return toDate;
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today.toISOString().slice(0, 10);
}

/**
 * Fetch trailing CTP usage % per customer and compute limit-breach forecasts.
 * Calendar lookback is 2× trailingDays to allow for missing snapshot days.
 */
export async function fetchLimitBreachForecastPeriodCustomers(
    options: FetchLimitBreachForecastOptions
): Promise<CustomerLimitBreachForecastRow[]> {
    const trailingDays = Math.min(
        90,
        Math.max(7, options.trailingDays ?? LIMIT_BREACH_FORECAST_TRAILING_DAYS)
    );
    const toYmd = resolveToDateYmd(options.toDate);
    const toDateUtc = startOfUtcDayFromYmd(toYmd);
    if (toDateUtc == null) {
        return [];
    }

    const fromDateUtc = new Date(toDateUtc);
    // Extra calendar padding so available-day window can still fill trailingDays.
    fromDateUtc.setUTCDate(fromDateUtc.getUTCDate() - trailingDays * 2 + 1);

    const pendingReviewLiteral = "pending review";
    const includeNoPolicy = options.includeNoPolicyExposure !== false;
    const scoped = options.scopedCustomerIds ?? null;

    const rows = await prisma.$queryRaw<CptUsageRawRow[]>`
        SELECT
            t.customer_id,
            t.snapshot_date,
            SUM(COALESCE(t.usage_amount, 0))::float8 AS usage_amount,
            SUM(
                COALESCE(t.effective_approved_limit, t.approved_limit, 0)
            )::float8 AS effective_limit_sum,
            MAX(p.full_name) AS person_name,
            MAX(co.name) AS company_name,
            MAX(ip.policy_number) AS policy_number
        FROM "CustomerPolicyTrend" t
        INNER JOIN "Customer" c ON c.id = t.customer_id
        LEFT JOIN "Person" p ON p.id = c.person_id
        LEFT JOIN "Company" co ON co.id = c.company_id
        LEFT JOIN "InsurancePolicy" ip ON ip.id = t.insurance_policy_id
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
            policyNumber: string | null;
            points: Array<{ snapshotDate: string; value: number }>;
        }
    >();

    for (const row of rows) {
        const limitSum = toNumber(row.effective_limit_sum);
        if (limitSum <= 0) {
            continue;
        }
        const usagePct = (toNumber(row.usage_amount) / limitSum) * 100;
        if (!Number.isFinite(usagePct)) {
            continue;
        }
        let entry = byCustomer.get(row.customer_id);
        if (!entry) {
            entry = {
                customerName: resolveCustomerName(row),
                policyNumber: row.policy_number?.trim() || null,
                points: [],
            };
            byCustomer.set(row.customer_id, entry);
        }
        entry.points.push({
            snapshotDate: normalizeSnapshotYmd(row.snapshot_date),
            value: usagePct,
        });
    }

    const result: CustomerLimitBreachForecastRow[] = [];
    for (const [customerId, entry] of byCustomer) {
        const forecast = computeLimitBreachForecast(entry.points, {
            trailingDays,
        });
        if (options.projectedOnly && !hasProjectedLimitBreach(forecast)) {
            continue;
        }
        result.push({
            customerId,
            customerName: entry.customerName,
            policyNumber: entry.policyNumber,
            ...forecast,
        });
    }

    // Soonest projected first; then by customer id.
    return result.sort((a, b) => {
        const aDays = a.primary?.daysToThreshold ?? Infinity;
        const bDays = b.primary?.daysToThreshold ?? Infinity;
        if (aDays !== bDays) return aDays - bDays;
        return a.customerId - b.customerId;
    });
}

/** Projected-only cohort for Limit Warnings / export. */
export async function fetchProjectedLimitBreachCustomers(
    options: FetchLimitBreachForecastOptions
): Promise<CustomerLimitBreachForecastRow[]> {
    return fetchLimitBreachForecastPeriodCustomers({
        ...options,
        projectedOnly: true,
    });
}

export async function fetchCustomerTrailingLimitBreachForecast(options: {
    accountId: number;
    customerId: number;
    policyId?: number;
    trailingDays?: number;
}): Promise<CustomerLimitBreachForecastRow | null> {
    const rows = await fetchLimitBreachForecastPeriodCustomers({
        accountId: options.accountId,
        customerId: options.customerId,
        policyId: options.policyId,
        trailingDays: options.trailingDays,
        includeNoPolicyExposure: true,
    });
    return rows[0] ?? null;
}
