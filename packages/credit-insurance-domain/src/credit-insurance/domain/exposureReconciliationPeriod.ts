/**
 * Period CTP cohort for AR / exposure reconciliation failures (KPI #13).
 */

import { prisma } from "../domain-db";
import {
    RECONCILIATION_ABS_DELTA_EPSILON,
    collectExposureReconciliationFailures,
    summarizeCustomerExposureReconciliation,
    summarizePortfolioExposureReconciliation,
    type CustomerExposureReconciliationSummary,
    type ExposureReconciliationFlaggedRow,
    type PortfolioExposureReconciliationSummary,
    type ReconciliationThresholds,
} from "./shared/ctpExposureReconciliationMetrics";

type CptReconRawRow = {
    customer_id: number;
    snapshot_date: Date | string;
    total_receivables: number | string | null;
    at_risk_exposure: number | string | null;
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

export type FetchExposureReconciliationPeriodOptions = {
    accountId: number;
    fromDate: string;
    toDate: string;
    policyId?: number;
    customerId?: number;
    scopedCustomerIds?: number[] | null;
    includeNoPolicyExposure?: boolean;
    thresholds?: ReconciliationThresholds;
    previewLimit?: number;
};

export type ExposureReconciliationPeriodResult = {
    summary: PortfolioExposureReconciliationSummary;
    rows: ExposureReconciliationFlaggedRow[];
    previewRows: ExposureReconciliationFlaggedRow[];
    customers: CustomerExposureReconciliationSummary[];
};

async function fetchReconRawRows(
    options: FetchExposureReconciliationPeriodOptions
): Promise<CptReconRawRow[]> {
    const fromDateUtc = startOfUtcDayFromYmd(options.fromDate);
    const toDateUtc = startOfUtcDayFromYmd(options.toDate);
    if (fromDateUtc == null || toDateUtc == null) {
        return [];
    }

    const pendingReviewLiteral = "pending review";
    const includeNoPolicy = options.includeNoPolicyExposure !== false;
    const scoped = options.scopedCustomerIds ?? null;
    const epsilon =
        options.thresholds?.epsilon ?? RECONCILIATION_ABS_DELTA_EPSILON;

    return prisma.$queryRaw<CptReconRawRow[]>`
        SELECT
            t.customer_id,
            t.snapshot_date,
            COALESCE(t.total_receivables, 0)::float8 AS total_receivables,
            COALESCE(t.at_risk_exposure, 0)::float8 AS at_risk_exposure,
            COALESCE(t.compliant_exposure, 0)::float8 AS compliant_exposure,
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
            ABS(
              COALESCE(t.at_risk_exposure, 0)
              + COALESCE(t.compliant_exposure, 0)
              - COALESCE(t.total_receivables, 0)
            ) > ${epsilon}
            OR (
              COALESCE(t.at_risk_exposure, 0)
              - COALESCE(t.total_receivables, 0)
            ) > ${epsilon}
          )
        GROUP BY
            t.customer_id,
            t.snapshot_date,
            t.insurance_policy_id,
            t.total_receivables,
            t.at_risk_exposure,
            t.compliant_exposure
    `;
}

function emptyResult(
    thresholds?: ReconciliationThresholds
): ExposureReconciliationPeriodResult {
    return {
        summary: {
            failingRowCount: 0,
            maxAbsDelta: null,
            customersAffected: 0,
            atRiskExceedsTotalRowCount: 0,
            atRiskExceedsTotalCustomers: 0,
            maxAtRiskExcess: null,
            epsilon: thresholds?.epsilon ?? RECONCILIATION_ABS_DELTA_EPSILON,
        },
        rows: [],
        previewRows: [],
        customers: [],
    };
}

export async function fetchExposureReconciliationPeriod(
    options: FetchExposureReconciliationPeriodOptions
): Promise<ExposureReconciliationPeriodResult> {
    const raw = await fetchReconRawRows(options);
    if (raw.length === 0) {
        return emptyResult(options.thresholds);
    }

    const rows = collectExposureReconciliationFailures(
        raw.map((row) => ({
            customerId: row.customer_id,
            customerName: resolveCustomerName(row),
            snapshotDate: normalizeSnapshotYmd(row.snapshot_date),
            totalReceivables: toNumber(row.total_receivables),
            atRiskExposure: toNumber(row.at_risk_exposure),
            compliantExposure: toNumber(row.compliant_exposure),
        })),
        options.thresholds
    );

    const previewLimit =
        options.previewLimit != null && options.previewLimit > 0
            ? options.previewLimit
            : 50;

    return {
        summary: summarizePortfolioExposureReconciliation(
            rows,
            options.thresholds
        ),
        rows,
        previewRows: rows.slice(0, previewLimit),
        customers: summarizeCustomerExposureReconciliation(rows),
    };
}

export async function fetchExposureReconciliationPeriodCustomers(
    options: FetchExposureReconciliationPeriodOptions
): Promise<CustomerExposureReconciliationSummary[]> {
    const result = await fetchExposureReconciliationPeriod(options);
    return result.customers;
}

export async function fetchExposureReconciliationPeriodSummary(
    options: FetchExposureReconciliationPeriodOptions
): Promise<ExposureReconciliationPeriodResult> {
    return fetchExposureReconciliationPeriod(options);
}
