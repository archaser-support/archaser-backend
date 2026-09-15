/**
 * Period CTP cohort for breach dilution (KPI #11) + clean-streak / episodes
 * (KPI #12). Same approved-customer filter as capacity-gap-days.
 */

import { prisma } from "../domain-db";
import {
    computeCustomerBreachDilutionStreakMetrics,
    formatBreachEpisodesSummary,
    latestBreachEpisode,
    rankDilutedCustomers,
    summarizePortfolioBreachDilutionStreak,
    type BreachDilutionThresholds,
    type CustomerBreachDilutionStreakRow,
    type PortfolioBreachDilutionStreakSummary,
} from "./shared/ctpBreachDilutionStreakMetrics";

type CptBreachRawRow = {
    customer_id: number;
    snapshot_date: Date | string;
    terms_breach_amount: number | string | null;
    total_receivables: number | string | null;
    health_index: number | string | null;
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

export type FetchBreachDilutionStreakPeriodOptions = {
    accountId: number;
    fromDate: string;
    toDate: string;
    policyId?: number;
    customerId?: number;
    scopedCustomerIds?: number[] | null;
    includeNoPolicyExposure?: boolean;
    thresholds?: BreachDilutionThresholds;
};

export type BreachDilutionStreakPeriodResult = {
    rows: CustomerBreachDilutionStreakRow[];
    summary: PortfolioBreachDilutionStreakSummary;
    dilutedRanking: CustomerBreachDilutionStreakRow[];
};

/**
 * Approved customers (linked policy, not excluded) with CTP days in range.
 */
export async function fetchBreachDilutionStreakPeriodCustomers(
    options: FetchBreachDilutionStreakPeriodOptions
): Promise<CustomerBreachDilutionStreakRow[]> {
    const fromDateUtc = startOfUtcDayFromYmd(options.fromDate);
    const toDateUtc = startOfUtcDayFromYmd(options.toDate);
    if (fromDateUtc == null || toDateUtc == null) {
        return [];
    }

    const pendingReviewLiteral = "pending review";
    const includeNoPolicy = options.includeNoPolicyExposure !== false;
    const scoped = options.scopedCustomerIds ?? null;

    const rows = await prisma.$queryRaw<CptBreachRawRow[]>`
        SELECT
            t.customer_id,
            t.snapshot_date,
            SUM(COALESCE(t.terms_breach_amount, 0))::float8 AS terms_breach_amount,
            SUM(COALESCE(t.total_receivables, 0))::float8 AS total_receivables,
            AVG(t.health_index)::float8 AS health_index,
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
            points: Array<{
                snapshotDate: string;
                termsBreachAmount: number;
                totalReceivables: number;
                healthIndex: number | null;
            }>;
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
            termsBreachAmount: toNumber(row.terms_breach_amount),
            totalReceivables: toNumber(row.total_receivables),
            healthIndex: toNullableNumber(row.health_index),
        });
    }

    const result: CustomerBreachDilutionStreakRow[] = [];
    for (const [customerId, entry] of byCustomer) {
        const metrics = computeCustomerBreachDilutionStreakMetrics(
            entry.points,
            options.thresholds
        );
        result.push({
            customerId,
            customerName: entry.customerName,
            ...metrics,
        });
    }
    return result;
}

export async function fetchBreachDilutionStreakPeriodSummary(
    options: FetchBreachDilutionStreakPeriodOptions
): Promise<BreachDilutionStreakPeriodResult> {
    const rows = await fetchBreachDilutionStreakPeriodCustomers(options);
    return {
        rows,
        summary: summarizePortfolioBreachDilutionStreak(rows),
        dilutedRanking: rankDilutedCustomers(rows),
    };
}

/** Diluted customers only (PH Tab 1 queue + report membership). */
export async function fetchDilutedBreachPeriodCustomers(
    options: FetchBreachDilutionStreakPeriodOptions
): Promise<CustomerBreachDilutionStreakRow[]> {
    const rows = await fetchBreachDilutionStreakPeriodCustomers(options);
    return rankDilutedCustomers(rows);
}

/** Customers with ≥1 breach episode (episode-history report membership). */
export async function fetchBreachEpisodePeriodCustomers(
    options: FetchBreachDilutionStreakPeriodOptions
): Promise<CustomerBreachDilutionStreakRow[]> {
    const rows = await fetchBreachDilutionStreakPeriodCustomers(options);
    return rows
        .filter((r) => r.hasBreachHistory)
        .sort((a, b) => {
            if (b.episodeCount !== a.episodeCount) {
                return b.episodeCount - a.episodeCount;
            }
            return (b.longestBreachStreak.days ?? 0) - (a.longestBreachStreak.days ?? 0);
        });
}

/**
 * Trailing-window metrics for one customer (Customer dashboard banner + badge).
 */
export async function fetchCustomerTrailingBreachDilutionStreakMetrics(options: {
    accountId: number;
    customerId: number;
    policyId?: number;
    days?: number;
    thresholds?: BreachDilutionThresholds;
}): Promise<CustomerBreachDilutionStreakRow | null> {
    const days = Math.min(365, Math.max(7, options.days ?? 90));
    const toDateUtc = new Date();
    toDateUtc.setUTCHours(0, 0, 0, 0);
    const fromDateUtc = new Date(toDateUtc);
    fromDateUtc.setUTCDate(fromDateUtc.getUTCDate() - (days - 1));

    const rows = await fetchBreachDilutionStreakPeriodCustomers({
        accountId: options.accountId,
        customerId: options.customerId,
        policyId: options.policyId,
        fromDate: fromDateUtc.toISOString().slice(0, 10),
        toDate: toDateUtc.toISOString().slice(0, 10),
        includeNoPolicyExposure: true,
        thresholds: options.thresholds,
    });
    return rows[0] ?? null;
}

export function breachEpisodeReportFields(
    row: CustomerBreachDilutionStreakRow
): {
    period_breach_status: string;
    period_breach_streak_days: number;
    period_breach_episode_count: number;
    period_breach_episodes_summary: string;
    period_breach_last_episode_start: string | null;
    period_breach_last_episode_end: string | null;
    period_breach_last_episode_ongoing: boolean;
    period_breach_last_episode_days: number | null;
    period_breach_last_episode_peak: number | null;
    period_longest_breach_streak_days: number;
} {
    const last = latestBreachEpisode(row.episodes);
    return {
        period_breach_status: row.status,
        period_breach_streak_days: row.streakDays,
        period_breach_episode_count: row.episodeCount,
        period_breach_episodes_summary: formatBreachEpisodesSummary(
            row.episodes
        ),
        period_breach_last_episode_start: last?.start ?? null,
        period_breach_last_episode_end: last?.ongoing ? null : (last?.end ?? null),
        period_breach_last_episode_ongoing: last?.ongoing ?? false,
        period_breach_last_episode_days: last?.days ?? null,
        period_breach_last_episode_peak: last?.peakAmount ?? null,
        period_longest_breach_streak_days: row.longestBreachStreak.days,
    };
}
