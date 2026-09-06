import { Prisma } from "@prisma/client";
import { prisma } from "../domain-db";

import {
    effectivelyActivePrismaWhere,
    startOfTodayUtc,
} from "./shared/insurancePolicyLifecycle";

import {
    getCreditDashboardSummary,
    type CreditDashboardSummary,
} from "./creditInsuranceDashboardService";
import { hasTopUpPolicies } from "./hasTopUpPolicies";
import { runInsurancePolicyStatusMaintenance } from "./insurancePolicyStatusCron";
import { withReportingBreachIgnored } from "./asOfOpenAr";

type SnapshotScope = {
    accountId: number;
    policyId: number | null;
    businessUnitId: number | null;
};

export type CreditDashboardSummaryHistoryScope = {
    isAdmin: boolean;
    selectedBusinessUnitId: number | null;
    /** Null for admin; empty when user has no accessible business units. */
    accessibleBusinessUnitIds: number[] | null;
};

type SnapshotRow = {
    snapshot_date: Date;
    total_receivables: number;
    compliant_exposure: number;
    at_risk_exposure: number;
    health_index: number;
    overdue_block_customer_count: number;
    capacity_gap_total_amount: number;
    terms_breach_total_amount: number;
    without_policy_total_amount: number;
    reporting_countdown_invoice_count: number;
    limit_warnings_customer_count: number;
};

export type CreditDashboardHistoryPoint = {
    snapshotDate: string;
    totalReceivables: number;
    compliantExposure: number;
    atRiskExposure: number;
    healthIndex: number;
    overdueBlockCustomerCount: number;
    capacityGapTotalAmount: number;
    termsBreachTotalAmount: number;
    withoutPolicyTotalAmount: number;
    reportingCountdownInvoiceCount: number;
    limitWarningsCustomerCount: number;
};

export type CreditDashboardHistoryDelta = {
    totalReceivables: number | null;
    compliantExposure: number | null;
    atRiskExposure: number | null;
    healthIndex: number | null;
};

export type CreditDashboardMonthPct = {
    totalReceivables: number | null;
    compliantExposure: number | null;
    atRiskExposure: number | null;
    overdueBlockCustomerCount: number | null;
    capacityGapTotalAmount: number | null;
    termsBreachTotalAmount: number | null;
    withoutPolicyTotalAmount: number | null;
    reportingCountdownInvoiceCount: number | null;
    limitWarningsCustomerCount: number | null;
};

export type CreditDashboardHistoryInterval = "daily" | "weekly";

export type CreditDashboardSummaryHistory = {
    series: CreditDashboardHistoryPoint[];
    delta: CreditDashboardHistoryDelta;
    monthPct: CreditDashboardMonthPct;
    interval: CreditDashboardHistoryInterval;
};

function normalizeDateString(value: Date): string {
    return value.toISOString().slice(0, 10);
}

async function listSnapshotScopesForAccount(
    accountId: number,
    asOfDate: Date
): Promise<SnapshotScope[]> {
    const scopes: SnapshotScope[] = [
        {
            accountId,
            policyId: null,
            businessUnitId: null,
        },
    ];
    const policies = await prisma.insurancePolicy.findMany({
        where: {
            account_id: accountId,
            ...effectivelyActivePrismaWhere(asOfDate),
        },
        select: { id: true },
    });
    for (const policy of policies) {
        scopes.push({
            accountId,
            policyId: policy.id,
            businessUnitId: null,
        });
    }
    return scopes;
}

async function listSnapshotScopes(asOfDate: Date): Promise<SnapshotScope[]> {
    const accounts = await prisma.account.findMany({
        where: {
            has_credit_insurance: true,
        },
        select: { id: true },
    });

    const scopes: SnapshotScope[] = [];
    for (const account of accounts) {
        scopes.push(...(await listSnapshotScopesForAccount(account.id, asOfDate)));
    }
    return scopes;
}

async function processDashboardSnapshotsForAccount(
    accountId: number,
    accountScopes: SnapshotScope[],
    snapshotDate: Date,
    preloadedAsOfLines?: import("./asOfOpenAr").AsOfOpenInvoiceLine[],
    ignoreReportingBreach?: boolean
): Promise<number> {
    let scopesProcessed = 0;

    const loadedLines =
        preloadedAsOfLines ??
        (await (
            await import("./asOfOpenAr")
        ).loadAsOfOpenInvoiceCandidates(accountId, snapshotDate));
    const asOfLines = withReportingBreachIgnored(
        loadedLines,
        ignoreReportingBreach === true
    );

    for (const scope of accountScopes) {
        const summary = await getCreditDashboardSummary(
            scope.accountId,
            scope.policyId ?? undefined,
            undefined,
            true,
            { asOfDate: snapshotDate, asOfLines }
        );
        await upsertDailySnapshot(scope, summary, snapshotDate);
        scopesProcessed++;
    }

    const businessUnitIds = await listActiveBusinessUnitIds(accountId);
    for (const businessUnitId of businessUnitIds) {
        const businessUnitFilter = { business_unit_id: businessUnitId };
        for (const scope of accountScopes) {
            const summary = await getCreditDashboardSummary(
                scope.accountId,
                scope.policyId ?? undefined,
                businessUnitFilter,
                true,
                { asOfDate: snapshotDate, asOfLines }
            );
            await upsertDailySnapshot(
                { ...scope, businessUnitId },
                summary,
                snapshotDate
            );
            scopesProcessed++;
        }
    }

    return scopesProcessed;
}

type TopUpSnapshotAgg = {
    topUpCoverTotalAmount: number;
    customersWithActiveTopUpCount: number;
    topUpExpiringCustomerCount: number;
};

async function listActiveBusinessUnitIds(accountId: number): Promise<number[]> {
    const rows = await prisma.businessUnit.findMany({
        where: {
            account_id: accountId,
            status: "Active",
        },
        select: { id: true },
        orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
}

async function fetchTopUpSnapshotAgg(
    accountId: number,
    snapshotDate: Date,
    businessUnitId?: number | null
): Promise<TopUpSnapshotAgg> {
    const accountHasTopUp = await hasTopUpPolicies(accountId);
    if (!accountHasTopUp) {
        return {
            topUpCoverTotalAmount: 0,
            customersWithActiveTopUpCount: 0,
            topUpExpiringCustomerCount: 0,
        };
    }

    const sevenDaysFromNow = new Date(snapshotDate.getTime() + 7 * 86_400_000);

    const rows = await prisma.customerTopUp.findMany({
        where: {
            cancelled_at: null,
            start_date: { lte: snapshotDate },
            end_date: { gte: snapshotDate },
            Customer: {
                account_id: accountId,
                ...(businessUnitId != null
                    ? { business_unit_id: businessUnitId }
                    : {}),
            },
        },
        select: {
            top_up_value: true,
            top_up_type: true,
            currency: true,
            end_date: true,
            customer_id: true,
        },
    });

    const uniqueCustomers = new Set<number>();
    const expiringWithin7Days = new Set<number>();
    let totalCover = 0;

    for (const row of rows) {
        uniqueCustomers.add(row.customer_id);

        if (row.end_date <= sevenDaysFromNow) {
            expiringWithin7Days.add(row.customer_id);
        }

        if (row.top_up_type === "Fixed") {
            totalCover += new Prisma.Decimal(row.top_up_value).toNumber();
        }
        // Percentage top-ups can't be summed for cover total without the base limit
    }

    return {
        topUpCoverTotalAmount: totalCover,
        customersWithActiveTopUpCount: uniqueCustomers.size,
        topUpExpiringCustomerCount: expiringWithin7Days.size,
    };
}

async function upsertDailySnapshot(
    scope: SnapshotScope,
    summary: CreditDashboardSummary,
    snapshotDate: Date
) {
    const topUpAgg = await fetchTopUpSnapshotAgg(
        scope.accountId,
        snapshotDate,
        scope.businessUnitId
    );

    await prisma.$executeRaw`
        INSERT INTO "CreditDashboardDailySnapshot" (
            account_id,
            policy_id,
            business_unit_id,
            snapshot_date,
            health_index,
            total_receivables,
            compliant_exposure,
            at_risk_exposure,
            policy_risk_exposure,
            policy_risk_exposure_customer_count,
            gross_risk_exposure,
            overdue_block_customer_count,
            overdue_block_total_outstanding,
            capacity_gap_total_amount,
            capacity_gap_customer_over_limit_count,
            terms_breach_invoice_count,
            terms_breach_total_amount,
            terms_breach_count_by_reason,
            without_policy_customer_count,
            without_policy_total_amount,
            reporting_countdown_invoice_count,
            reporting_countdown_total_amount,
            reporting_countdown_window_days,
            limit_warnings_customer_count,
            limit_warnings_total_amount,
            limit_warnings_threshold_pct,
            limit_warnings_score_warn_days,
            account_currency,
            top_up_cover_total_amount,
            customers_with_active_top_up_count,
            top_up_expiring_customer_count
        )
        VALUES (
            ${scope.accountId},
            ${scope.policyId},
            ${scope.businessUnitId},
            ${snapshotDate},
            ${summary.healthIndex},
            ${summary.totalReceivables},
            ${summary.compliantExposure},
            ${summary.atRiskExposure},
            ${summary.policyRiskExposure},
            ${summary.policyRiskExposureCustomerCount},
            ${summary.grossRiskExposure},
            ${summary.overdueBlockCustomerCount},
            ${summary.overdueBlockTotalOutstanding},
            ${summary.capacityGap.totalAmount},
            ${summary.capacityGap.customerOverLimitCount},
            ${summary.termsBreach.invoiceCount},
            ${summary.termsBreach.totalAmount},
            ${JSON.stringify(summary.termsBreach.countByReason)}::jsonb,
            ${summary.withoutPolicy.customerCount},
            ${summary.withoutPolicy.totalAmount},
            ${summary.reportingCountdown.invoiceCount},
            ${summary.reportingCountdown.totalAmount},
            ${summary.reportingCountdown.windowDays},
            ${summary.limitWarnings.customerCount},
            ${summary.limitWarnings.totalAmount},
            ${summary.limitWarnings.thresholdPct},
            ${summary.limitWarnings.scoreWarnDays},
            ${summary.accountCurrency},
            ${topUpAgg.topUpCoverTotalAmount},
            ${topUpAgg.customersWithActiveTopUpCount},
            ${topUpAgg.topUpExpiringCustomerCount}
        )
        ON CONFLICT (
            account_id,
            (COALESCE(policy_id, 0)),
            (COALESCE(business_unit_id, 0)),
            snapshot_date
        )
        DO UPDATE SET
            health_index = EXCLUDED.health_index,
            total_receivables = EXCLUDED.total_receivables,
            compliant_exposure = EXCLUDED.compliant_exposure,
            at_risk_exposure = EXCLUDED.at_risk_exposure,
            policy_risk_exposure = EXCLUDED.policy_risk_exposure,
            policy_risk_exposure_customer_count = EXCLUDED.policy_risk_exposure_customer_count,
            gross_risk_exposure = EXCLUDED.gross_risk_exposure,
            overdue_block_customer_count = EXCLUDED.overdue_block_customer_count,
            overdue_block_total_outstanding = EXCLUDED.overdue_block_total_outstanding,
            capacity_gap_total_amount = EXCLUDED.capacity_gap_total_amount,
            capacity_gap_customer_over_limit_count = EXCLUDED.capacity_gap_customer_over_limit_count,
            terms_breach_invoice_count = EXCLUDED.terms_breach_invoice_count,
            terms_breach_total_amount = EXCLUDED.terms_breach_total_amount,
            terms_breach_count_by_reason = EXCLUDED.terms_breach_count_by_reason,
            without_policy_customer_count = EXCLUDED.without_policy_customer_count,
            without_policy_total_amount = EXCLUDED.without_policy_total_amount,
            reporting_countdown_invoice_count = EXCLUDED.reporting_countdown_invoice_count,
            reporting_countdown_total_amount = EXCLUDED.reporting_countdown_total_amount,
            reporting_countdown_window_days = EXCLUDED.reporting_countdown_window_days,
            limit_warnings_customer_count = EXCLUDED.limit_warnings_customer_count,
            limit_warnings_total_amount = EXCLUDED.limit_warnings_total_amount,
            limit_warnings_threshold_pct = EXCLUDED.limit_warnings_threshold_pct,
            limit_warnings_score_warn_days = EXCLUDED.limit_warnings_score_warn_days,
            account_currency = EXCLUDED.account_currency,
            top_up_cover_total_amount = EXCLUDED.top_up_cover_total_amount,
            customers_with_active_top_up_count = EXCLUDED.customers_with_active_top_up_count,
            top_up_expiring_customer_count = EXCLUDED.top_up_expiring_customer_count,
            modified_at = NOW()
    `;
}

/**
 * Full cron mirror for one credit-insurance account: account-wide and per-policy
 * scopes, each repeated for null BU and every active business unit.
 */
export async function takeCreditDashboardDailySnapshotsForAccount(
    accountId: number,
    options?: {
        snapshotDate?: Date;
        /** When set (e.g. shared backfill load), skip a second ledger query. */
        asOfLines?: import("./asOfOpenAr").AsOfOpenInvoiceLine[];
        /** Generate-job only: treat reporting-late as off in this snapshot. */
        ignoreReportingBreach?: boolean;
    }
): Promise<{ scopesProcessed: number }> {
    const snapshotDate = options?.snapshotDate ?? startOfTodayUtc();
    const accountScopes = await listSnapshotScopesForAccount(
        accountId,
        snapshotDate
    );
    const scopesProcessed = await processDashboardSnapshotsForAccount(
        accountId,
        accountScopes,
        snapshotDate,
        options?.asOfLines,
        options?.ignoreReportingBreach
    );
    return { scopesProcessed };
}

export async function takeCreditDashboardDailySnapshots(options?: {
    excludeAccountIds?: ReadonlySet<number>;
}): Promise<{
    scopesProcessed: number;
    skippedAccountIds: number[];
}> {
    await runInsurancePolicyStatusMaintenance();

    const snapshotDate = startOfTodayUtc();
    const scopes = await listSnapshotScopes(snapshotDate);
    const excludeAccountIds = options?.excludeAccountIds;

    let scopesProcessed = 0;
    const skippedAccountIds: number[] = [];

    const accountIds = Array.from(
        new Set(scopes.map((scope) => scope.accountId))
    );
    for (const accountId of accountIds) {
        if (excludeAccountIds?.has(accountId)) {
            skippedAccountIds.push(accountId);
            continue;
        }
        const accountScopes = scopes.filter(
            (scope) => scope.accountId === accountId
        );
        scopesProcessed += await processDashboardSnapshotsForAccount(
            accountId,
            accountScopes,
            snapshotDate
        );
    }

    return { scopesProcessed, skippedAccountIds };
}

function addUtcCalendarDays(d: Date, deltaDays: number): Date {
    const out = new Date(d.getTime());
    out.setUTCDate(out.getUTCDate() + deltaDays);
    return out;
}

/** UTC Monday (YYYY-MM-DD) for grouping daily snapshots into calendar weeks. */
function utcMondayKey(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    const dow = d.getUTCDay();
    const diff = dow === 0 ? 6 : dow - 1;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - diff);
    return monday.toISOString().slice(0, 10);
}

/** UTC Sunday (YYYY-MM-DD) — week-ending label for weekly chart points. */
function utcWeekEndingKey(mondayKey: string): string {
    const d = new Date(`${mondayKey}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
}

function bucketSpanDays(
    bucket: CreditDashboardHistoryPoint[],
    mondayKey: string
): number {
    if (bucket.length === 0) {
        return 0;
    }
    const mondayMs = new Date(`${mondayKey}T12:00:00.000Z`).getTime();
    const lastMs = new Date(
        `${bucket[bucket.length - 1]!.snapshotDate}T12:00:00.000Z`
    ).getTime();
    return Math.round((lastMs - mondayMs) / 86_400_000) + 1;
}

/** Remove trailing partial weeks and points closer than 6 days (overlapping week labels). */
function finalizeWeeklySeries(
    weekly: CreditDashboardHistoryPoint[],
    buckets: Map<string, CreditDashboardHistoryPoint[]>,
    weekKeys: string[]
): CreditDashboardHistoryPoint[] {
    let result = weekly;
    while (result.length > 1) {
        const lastKey = weekKeys[weekKeys.length - 1];
        const lastBucket = lastKey ? buckets.get(lastKey) : undefined;
        if (!lastKey || !lastBucket) {
            break;
        }
        const span = bucketSpanDays(lastBucket, lastKey);
        if (lastBucket.length < 2 || span < 6) {
            result = result.slice(0, -1);
            weekKeys.pop();
            continue;
        }
        break;
    }

    if (result.length <= 1) {
        return result;
    }

    const pruned: CreditDashboardHistoryPoint[] = [result[0]!];
    for (let i = 1; i < result.length; i++) {
        const prev = pruned[pruned.length - 1]!;
        const cur = result[i]!;
        const prevT = new Date(`${prev.snapshotDate}T12:00:00.000Z`).getTime();
        const curT = new Date(`${cur.snapshotDate}T12:00:00.000Z`).getTime();
        const gapDays = (curT - prevT) / 86_400_000;
        if (gapDays < 6) {
            continue;
        }
        pruned.push(cur);
    }
    return pruned;
}

function aggregateSeriesToWeekly(
    daily: CreditDashboardHistoryPoint[]
): CreditDashboardHistoryPoint[] {
    if (daily.length === 0) {
        return [];
    }
    const buckets = new Map<string, CreditDashboardHistoryPoint[]>();
    for (const point of daily) {
        const key = utcMondayKey(point.snapshotDate);
        const bucket = buckets.get(key) ?? [];
        bucket.push(point);
        buckets.set(key, bucket);
    }
    const weekKeys = Array.from(buckets.keys()).sort();
    const weekly = weekKeys.map((key) => {
        const points = buckets.get(key)!;
        points.sort((a, b) =>
            a.snapshotDate.localeCompare(b.snapshotDate)
        );
        const last = points[points.length - 1]!;
        return {
            ...last,
            snapshotDate: utcWeekEndingKey(key),
        };
    });
    return finalizeWeeklySeries(weekly, buckets, [...weekKeys]);
}

function historyDeltaFromSeries(
    series: CreditDashboardHistoryPoint[]
): CreditDashboardHistoryDelta {
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    return {
        totalReceivables:
            last && prev ? last.totalReceivables - prev.totalReceivables : null,
        compliantExposure:
            last && prev ? last.compliantExposure - prev.compliantExposure : null,
        atRiskExposure:
            last && prev ? last.atRiskExposure - prev.atRiskExposure : null,
        healthIndex: last && prev ? last.healthIndex - prev.healthIndex : null,
    };
}

function monthPctFromDailySeries(
    series: CreditDashboardHistoryPoint[]
): CreditDashboardMonthPct {
    const first = series[0];
    const last = series[series.length - 1];
    const MIN_DAYS_FOR_MONTH_PCT = 25;
    const spanDays =
        first && last
            ? (new Date(last.snapshotDate).getTime() -
                  new Date(first.snapshotDate).getTime()) /
              86_400_000
            : 0;
    const pct = (a: number | undefined, b: number | undefined): number | null => {
        if (a == null || b == null || b === 0) return null;
        const v = ((a - b) / Math.abs(b)) * 100;
        return Math.round(v * 10) / 10;
    };
    if (
        !first ||
        !last ||
        first === last ||
        spanDays < MIN_DAYS_FOR_MONTH_PCT
    ) {
        return {
            totalReceivables: null,
            compliantExposure: null,
            atRiskExposure: null,
            overdueBlockCustomerCount: null,
            capacityGapTotalAmount: null,
            termsBreachTotalAmount: null,
            withoutPolicyTotalAmount: null,
            reportingCountdownInvoiceCount: null,
            limitWarningsCustomerCount: null,
        };
    }
    return {
        totalReceivables: pct(last.totalReceivables, first.totalReceivables),
        compliantExposure: pct(last.compliantExposure, first.compliantExposure),
        atRiskExposure: pct(last.atRiskExposure, first.atRiskExposure),
        overdueBlockCustomerCount: pct(
            last.overdueBlockCustomerCount,
            first.overdueBlockCustomerCount
        ),
        capacityGapTotalAmount: pct(
            last.capacityGapTotalAmount,
            first.capacityGapTotalAmount
        ),
        termsBreachTotalAmount: pct(
            last.termsBreachTotalAmount,
            first.termsBreachTotalAmount
        ),
        withoutPolicyTotalAmount: pct(
            last.withoutPolicyTotalAmount,
            first.withoutPolicyTotalAmount
        ),
        reportingCountdownInvoiceCount: pct(
            last.reportingCountdownInvoiceCount,
            first.reportingCountdownInvoiceCount
        ),
        limitWarningsCustomerCount: pct(
            last.limitWarningsCustomerCount,
            first.limitWarningsCustomerCount
        ),
    };
}

/** Minimum daily span for month-over-month % on metric cards (independent of chart interval). */
const MIN_DAILY_DAYS_FOR_MONTH_PCT = 30;

function snapshotRowToHistoryPoint(row: SnapshotRow): CreditDashboardHistoryPoint {
    return {
        snapshotDate: normalizeDateString(row.snapshot_date),
        totalReceivables: Number(row.total_receivables ?? 0),
        compliantExposure: Number(row.compliant_exposure ?? 0),
        atRiskExposure: Number(row.at_risk_exposure ?? 0),
        healthIndex: Number(row.health_index ?? 0),
        overdueBlockCustomerCount: Number(row.overdue_block_customer_count ?? 0),
        capacityGapTotalAmount: Number(row.capacity_gap_total_amount ?? 0),
        termsBreachTotalAmount: Number(row.terms_breach_total_amount ?? 0),
        withoutPolicyTotalAmount: Number(row.without_policy_total_amount ?? 0),
        reportingCountdownInvoiceCount: Number(
            row.reporting_countdown_invoice_count ?? 0
        ),
        limitWarningsCustomerCount: Number(
            row.limit_warnings_customer_count ?? 0
        ),
    };
}

export function computeCreditDashboardHealthIndex(
    compliantExposure: number,
    totalReceivables: number
): number {
    if (totalReceivables <= 0) {
        return 100;
    }
    return Math.max(
        0,
        Math.min(100, (100 * compliantExposure) / totalReceivables)
    );
}

export function aggregateCreditDashboardSnapshotRowsByDate(
    rows: CreditDashboardHistoryPoint[]
): CreditDashboardHistoryPoint[] {
    const byDate = new Map<string, CreditDashboardHistoryPoint[]>();
    for (const row of rows) {
        const bucket = byDate.get(row.snapshotDate) ?? [];
        bucket.push(row);
        byDate.set(row.snapshotDate, bucket);
    }

    return Array.from(byDate.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([snapshotDate, points]) => {
            const totalReceivables = points.reduce(
                (sum, point) => sum + point.totalReceivables,
                0
            );
            const compliantExposure = points.reduce(
                (sum, point) => sum + point.compliantExposure,
                0
            );
            const atRiskExposure = points.reduce(
                (sum, point) => sum + point.atRiskExposure,
                0
            );

            return {
                snapshotDate,
                totalReceivables,
                compliantExposure,
                atRiskExposure,
                healthIndex: computeCreditDashboardHealthIndex(
                    compliantExposure,
                    totalReceivables
                ),
                overdueBlockCustomerCount: points.reduce(
                    (sum, point) => sum + point.overdueBlockCustomerCount,
                    0
                ),
                capacityGapTotalAmount: points.reduce(
                    (sum, point) => sum + point.capacityGapTotalAmount,
                    0
                ),
                termsBreachTotalAmount: points.reduce(
                    (sum, point) => sum + point.termsBreachTotalAmount,
                    0
                ),
                withoutPolicyTotalAmount: points.reduce(
                    (sum, point) => sum + point.withoutPolicyTotalAmount,
                    0
                ),
                reportingCountdownInvoiceCount: points.reduce(
                    (sum, point) => sum + point.reportingCountdownInvoiceCount,
                    0
                ),
                limitWarningsCustomerCount: points.reduce(
                    (sum, point) => sum + point.limitWarningsCustomerCount,
                    0
                ),
            };
        });
}

async function fetchAccountWideSnapshotRows(
    accountId: number,
    policyId: number | undefined,
    fromDateUtc: Date,
    toDateUtc: Date
): Promise<SnapshotRow[]> {
    if (policyId != null) {
        return prisma.$queryRaw<Array<SnapshotRow>>`
            SELECT
                snapshot_date,
                total_receivables,
                compliant_exposure,
                at_risk_exposure,
                health_index,
                overdue_block_customer_count,
                capacity_gap_total_amount,
                terms_breach_total_amount,
                without_policy_total_amount,
                reporting_countdown_invoice_count,
                limit_warnings_customer_count
            FROM "CreditDashboardDailySnapshot"
            WHERE account_id = ${accountId}
              AND snapshot_date >= ${fromDateUtc}
              AND snapshot_date <= ${toDateUtc}
              AND policy_id = ${policyId}
              AND business_unit_id IS NULL
            ORDER BY snapshot_date ASC
        `;
    }

    return prisma.$queryRaw<Array<SnapshotRow>>`
        SELECT DISTINCT ON (snapshot_date)
            snapshot_date,
            total_receivables,
            compliant_exposure,
            at_risk_exposure,
            health_index,
            overdue_block_customer_count,
            capacity_gap_total_amount,
            terms_breach_total_amount,
            without_policy_total_amount,
            reporting_countdown_invoice_count,
            limit_warnings_customer_count
        FROM "CreditDashboardDailySnapshot"
        WHERE account_id = ${accountId}
          AND snapshot_date >= ${fromDateUtc}
          AND snapshot_date <= ${toDateUtc}
          AND business_unit_id IS NULL
        ORDER BY
            snapshot_date ASC,
            (CASE WHEN policy_id IS NULL THEN 1 ELSE 0 END) DESC,
            policy_id ASC
    `;
}

async function fetchBusinessUnitSnapshotRows(
    accountId: number,
    policyId: number | undefined,
    businessUnitId: number,
    fromDateUtc: Date,
    toDateUtc: Date
): Promise<SnapshotRow[]> {
    if (policyId != null) {
        return prisma.$queryRaw<Array<SnapshotRow>>`
            SELECT
                snapshot_date,
                total_receivables,
                compliant_exposure,
                at_risk_exposure,
                health_index,
                overdue_block_customer_count,
                capacity_gap_total_amount,
                terms_breach_total_amount,
                without_policy_total_amount,
                reporting_countdown_invoice_count,
                limit_warnings_customer_count
            FROM "CreditDashboardDailySnapshot"
            WHERE account_id = ${accountId}
              AND snapshot_date >= ${fromDateUtc}
              AND snapshot_date <= ${toDateUtc}
              AND policy_id = ${policyId}
              AND business_unit_id = ${businessUnitId}
            ORDER BY snapshot_date ASC
        `;
    }

    return prisma.$queryRaw<Array<SnapshotRow>>`
        SELECT
            snapshot_date,
            total_receivables,
            compliant_exposure,
            at_risk_exposure,
            health_index,
            overdue_block_customer_count,
            capacity_gap_total_amount,
            terms_breach_total_amount,
            without_policy_total_amount,
            reporting_countdown_invoice_count,
            limit_warnings_customer_count
        FROM "CreditDashboardDailySnapshot"
        WHERE account_id = ${accountId}
          AND snapshot_date >= ${fromDateUtc}
          AND snapshot_date <= ${toDateUtc}
          AND policy_id IS NULL
          AND business_unit_id = ${businessUnitId}
        ORDER BY snapshot_date ASC
    `;
}

async function fetchAccessibleBusinessUnitSnapshotRows(
    accountId: number,
    policyId: number | undefined,
    businessUnitIds: number[],
    fromDateUtc: Date,
    toDateUtc: Date
): Promise<SnapshotRow[]> {
    if (businessUnitIds.length === 0) {
        return [];
    }

    if (policyId != null) {
        return prisma.$queryRaw<Array<SnapshotRow>>`
            SELECT
                snapshot_date,
                total_receivables,
                compliant_exposure,
                at_risk_exposure,
                health_index,
                overdue_block_customer_count,
                capacity_gap_total_amount,
                terms_breach_total_amount,
                without_policy_total_amount,
                reporting_countdown_invoice_count,
                limit_warnings_customer_count
            FROM "CreditDashboardDailySnapshot"
            WHERE account_id = ${accountId}
              AND snapshot_date >= ${fromDateUtc}
              AND snapshot_date <= ${toDateUtc}
              AND policy_id = ${policyId}
              AND business_unit_id IN (${Prisma.join(businessUnitIds)})
            ORDER BY snapshot_date ASC, business_unit_id ASC
        `;
    }

    return prisma.$queryRaw<Array<SnapshotRow>>`
        SELECT
            snapshot_date,
            total_receivables,
            compliant_exposure,
            at_risk_exposure,
            health_index,
            overdue_block_customer_count,
            capacity_gap_total_amount,
            terms_breach_total_amount,
            without_policy_total_amount,
            reporting_countdown_invoice_count,
            limit_warnings_customer_count
        FROM "CreditDashboardDailySnapshot"
        WHERE account_id = ${accountId}
          AND snapshot_date >= ${fromDateUtc}
          AND snapshot_date <= ${toDateUtc}
          AND policy_id IS NULL
          AND business_unit_id IN (${Prisma.join(businessUnitIds)})
        ORDER BY snapshot_date ASC, business_unit_id ASC
    `;
}

export async function getCreditDashboardSummaryHistory(
    accountId: number,
    days: number,
    policyId: number | undefined,
    interval: CreditDashboardHistoryInterval = "daily",
    scope: CreditDashboardSummaryHistoryScope
): Promise<CreditDashboardSummaryHistory> {
    const safeDays = Math.max(2, Math.min(days, 365));
    const safeInterval: CreditDashboardHistoryInterval =
        interval === "weekly" ? "weekly" : "daily";
    /** Fetch enough daily rows for month % (at least 30 days). */
    const fetchDays = Math.max(safeDays, MIN_DAILY_DAYS_FOR_MONTH_PCT);
    /** Match snapshot writer {@link startOfTodayUtc} — avoids CURRENT_DATE vs stored DATE drift. */
    const toDateUtc = startOfTodayUtc();
    const fromDateUtc = addUtcCalendarDays(toDateUtc, -(fetchDays - 1));

    let rows: SnapshotRow[] = [];
    const { isAdmin, selectedBusinessUnitId, accessibleBusinessUnitIds } =
        scope;

    if (isAdmin && selectedBusinessUnitId == null) {
        rows = await fetchAccountWideSnapshotRows(
            accountId,
            policyId,
            fromDateUtc,
            toDateUtc
        );
    } else if (selectedBusinessUnitId != null) {
        rows = await fetchBusinessUnitSnapshotRows(
            accountId,
            policyId,
            selectedBusinessUnitId,
            fromDateUtc,
            toDateUtc
        );
    } else {
        rows = await fetchAccessibleBusinessUnitSnapshotRows(
            accountId,
            policyId,
            accessibleBusinessUnitIds ?? [],
            fromDateUtc,
            toDateUtc
        );
    }

    let dailySeries = rows.map(snapshotRowToHistoryPoint);
    if (!isAdmin && selectedBusinessUnitId == null) {
        dailySeries = aggregateCreditDashboardSnapshotRowsByDate(dailySeries);
    }

    const monthPct = monthPctFromDailySeries(dailySeries);

    let series: CreditDashboardHistoryPoint[];
    if (safeInterval === "weekly") {
        series = aggregateSeriesToWeekly(dailySeries);
    } else if (dailySeries.length > safeDays) {
        series = dailySeries.slice(-safeDays);
    } else {
        series = dailySeries;
    }

    const delta = historyDeltaFromSeries(series);

    return { series, delta, monthPct, interval: safeInterval };
}
