/**
 * Period / snapshot loaders for policy concentration (KPI #9).
 * Shares are computed on the latest (or selected) snapshot day per policy.
 */

import { prisma } from "../domain-db";
import {
    computeCustomerShareOfPolicyOpenAr,
    computePolicyConcentrationMetrics,
    type PolicyConcentrationMetrics,
    type PolicyConcentrationRankedCustomer,
} from "./shared/ctpPolicyConcentrationMetrics";

type CptConcentrationRawRow = {
    insurance_policy_id: number;
    customer_id: number;
    snapshot_date: Date | string;
    total_receivables: number | string | null;
    policy_number: string | null;
    person_name: string | null;
    company_name: string | null;
};

export type PolicyConcentrationSnapshotRow = PolicyConcentrationMetrics & {
    policyId: number;
    policyNumber: string | null;
    asOfDate: string;
};

export type FetchPolicyConcentrationOptions = {
    accountId: number;
    /** Inclusive range; latest snapshot on or before toDate is used. */
    fromDate: string;
    toDate: string;
    policyId?: number;
    customerId?: number;
    scopedCustomerIds?: number[] | null;
    includeNoPolicyExposure?: boolean;
    /** Pin to a specific snapshot day (must fall within from/to). */
    asOfDate?: string;
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

/**
 * Load approved CTP rows for concentration on the as-of snapshot day
 * (latest day with data on or before toDate, optionally pinned).
 */
export async function fetchPolicyConcentrationSnapshots(
    options: FetchPolicyConcentrationOptions
): Promise<PolicyConcentrationSnapshotRow[]> {
    const fromDateUtc = startOfUtcDayFromYmd(options.fromDate);
    const toDateUtc = startOfUtcDayFromYmd(options.toDate);
    if (fromDateUtc == null || toDateUtc == null) {
        return [];
    }

    const pendingReviewLiteral = "pending review";
    const includeNoPolicy = options.includeNoPolicyExposure !== false;
    const scoped = options.scopedCustomerIds ?? null;
    const pinAsOf = options.asOfDate
        ? startOfUtcDayFromYmd(options.asOfDate)
        : null;

    const rows = await prisma.$queryRaw<CptConcentrationRawRow[]>`
        WITH latest AS (
            SELECT
                t.insurance_policy_id,
                MAX(t.snapshot_date) AS as_of
            FROM "CustomerPolicyTrend" t
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
                ${pinAsOf == null}::boolean
                OR t.snapshot_date = ${pinAsOf}::date
              )
              AND (
                ${includeNoPolicy}::boolean
                OR COALESCE(t.total_receivables, 0) <= 0
                OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
              )
            GROUP BY t.insurance_policy_id
        )
        SELECT
            t.insurance_policy_id,
            t.customer_id,
            t.snapshot_date,
            COALESCE(t.total_receivables, 0)::float8 AS total_receivables,
            ip.policy_number,
            p.full_name AS person_name,
            co.name AS company_name
        FROM "CustomerPolicyTrend" t
        INNER JOIN latest l
            ON l.insurance_policy_id = t.insurance_policy_id
           AND l.as_of = t.snapshot_date
        INNER JOIN "Customer" c ON c.id = t.customer_id
        LEFT JOIN "Person" p ON p.id = c.person_id
        LEFT JOIN "Company" co ON co.id = c.company_id
        LEFT JOIN "InsurancePolicy" ip ON ip.id = t.insurance_policy_id
        WHERE t.account_id = ${options.accountId}
          AND t.insurance_policy_id IS NOT NULL
          AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
          AND (
            ${scoped == null}::boolean
            OR t.customer_id = ANY(${scoped ?? []}::int[])
          )
        ORDER BY t.insurance_policy_id ASC, t.customer_id ASC
    `;

    const byPolicy = new Map<
        number,
        {
            policyNumber: string | null;
            asOfDate: string;
            customers: Array<{
                customerId: number;
                customerName: string;
                openAr: number;
            }>;
        }
    >();

    for (const row of rows) {
        const policyId = row.insurance_policy_id;
        let entry = byPolicy.get(policyId);
        if (!entry) {
            entry = {
                policyNumber: row.policy_number?.trim() || null,
                asOfDate: normalizeSnapshotYmd(row.snapshot_date),
                customers: [],
            };
            byPolicy.set(policyId, entry);
        }
        entry.customers.push({
            customerId: row.customer_id,
            customerName: resolveCustomerName(row),
            openAr: toNumber(row.total_receivables),
        });
    }

    const result: PolicyConcentrationSnapshotRow[] = [];
    for (const [policyId, entry] of byPolicy) {
        const metrics = computePolicyConcentrationMetrics(entry.customers);
        result.push({
            policyId,
            policyNumber: entry.policyNumber,
            asOfDate: entry.asOfDate,
            ...metrics,
        });
    }

    // Alerting policies first, then by top-1 share DESC.
    return result.sort((a, b) => {
        if (a.concentrationAlert !== b.concentrationAlert) {
            return a.concentrationAlert ? -1 : 1;
        }
        const shareDiff = (b.top1SharePct ?? 0) - (a.top1SharePct ?? 0);
        if (shareDiff !== 0) return shareDiff;
        return a.policyId - b.policyId;
    });
}

/** Flatten ranked customers across policies for the exportable report. */
export async function fetchPolicyConcentrationRankingRows(
    options: FetchPolicyConcentrationOptions
): Promise<
    Array<
        PolicyConcentrationRankedCustomer & {
            policyId: number;
            policyNumber: string | null;
            asOfDate: string;
            top1SharePct: number | null;
            top3SharePct: number | null;
            alertEligible: boolean;
            concentrationAlert: boolean;
        }
    >
> {
    const snapshots = await fetchPolicyConcentrationSnapshots(options);
    const rows: Array<
        PolicyConcentrationRankedCustomer & {
            policyId: number;
            policyNumber: string | null;
            asOfDate: string;
            top1SharePct: number | null;
            top3SharePct: number | null;
            alertEligible: boolean;
            concentrationAlert: boolean;
        }
    > = [];

    for (const snap of snapshots) {
        for (const customer of snap.ranking) {
            rows.push({
                ...customer,
                policyId: snap.policyId,
                policyNumber: snap.policyNumber,
                asOfDate: snap.asOfDate,
                top1SharePct: snap.top1SharePct,
                top3SharePct: snap.top3SharePct,
                alertEligible: snap.alertEligible,
                concentrationAlert: snap.concentrationAlert,
            });
        }
    }
    return rows;
}

/**
 * Customer dashboard context: share of the scoped policy's open AR on the
 * latest available CTP day (trailing window ending today).
 */
export async function fetchCustomerShareOfPolicyOpenAr(options: {
    accountId: number;
    customerId: number;
    policyId?: number;
    days?: number;
}): Promise<{
    sharePct: number | null;
    policyId: number | null;
    policyNumber: string | null;
    asOfDate: string | null;
    customerOpenAr: number;
    policyTotalOpenAr: number;
} | null> {
    const days = Math.min(365, Math.max(7, options.days ?? 90));
    const toDateUtc = new Date();
    toDateUtc.setUTCHours(0, 0, 0, 0);
    const fromDateUtc = new Date(toDateUtc);
    fromDateUtc.setUTCDate(fromDateUtc.getUTCDate() - (days - 1));

    const fromDate = fromDateUtc.toISOString().slice(0, 10);
    const toDate = toDateUtc.toISOString().slice(0, 10);

    // Prefer explicit policy; otherwise use customer's active primary policy from CTP.
    let policyId = options.policyId ?? null;
    if (policyId == null) {
        const latest = await prisma.$queryRaw<
            Array<{ insurance_policy_id: number }>
        >`
            SELECT t.insurance_policy_id
            FROM "CustomerPolicyTrend" t
            WHERE t.account_id = ${options.accountId}
              AND t.customer_id = ${options.customerId}
              AND t.snapshot_date >= ${fromDateUtc}::date
              AND t.snapshot_date <= ${toDateUtc}::date
              AND t.insurance_policy_id IS NOT NULL
              AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
            ORDER BY t.snapshot_date DESC
            LIMIT 1
        `;
        policyId = latest[0]?.insurance_policy_id ?? null;
    }
    if (policyId == null) {
        return null;
    }

    const snaps = await fetchPolicyConcentrationSnapshots({
        accountId: options.accountId,
        fromDate,
        toDate,
        policyId,
        includeNoPolicyExposure: true,
    });
    const snap = snaps[0];
    if (!snap) {
        return {
            sharePct: null,
            policyId,
            policyNumber: null,
            asOfDate: null,
            customerOpenAr: 0,
            policyTotalOpenAr: 0,
        };
    }

    const self = snap.ranking.find((r) => r.customerId === options.customerId);
    const customerOpenAr = self?.openAr ?? 0;
    const sharePct = computeCustomerShareOfPolicyOpenAr(
        customerOpenAr,
        snap.totalOpenAr
    );

    return {
        sharePct,
        policyId: snap.policyId,
        policyNumber: snap.policyNumber,
        asOfDate: snap.asOfDate,
        customerOpenAr,
        policyTotalOpenAr: snap.totalOpenAr,
    };
}
