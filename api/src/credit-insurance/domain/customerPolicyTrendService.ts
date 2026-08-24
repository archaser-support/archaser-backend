import { cost_calculation_method, Prisma } from "@prisma/client";

import { prisma } from "../domain-db";

import {
    asOfCapacityGapAmount,
    asOfTermsBreachInvoicesFromLines,
    asOfTermsScopeKey,
    buildAsOfOpenReceivableByCustomerMapFromLines,
    loadAsOfOpenInvoiceCandidates,
    overlayAsOfTermsFlagsOnLines,
    resolveAsOfOpenArOnPolicyInLimitCurrencyFromLines,
    sumAsOfOpenAmountFromLines,
    sumAsOfTermsBreachFromLines,
    type AsOfOpenInvoiceLine,
    type AsOfPolicyTermsForBreach,
} from "./asOfOpenAr";
import { storedCapacityGapAmount } from "./policyGapAmounts";
import { computeCustomerRiskExposure } from "./invoiceInsuranceFields";
import { buildCustomerPolicyTrendSnapshotPayload } from "./customerPolicyTrendSnapshotPayload";
import {
    resolveCustomerTermsBreachOutstanding,
} from "./termBreachResolver";
import {
    hasActiveLinkedPolicy,
    isUncoveredExposureCustomer,
} from "./policyExclusion";
import {
    aggregateTermsBreachByReasonFromInvoices,
    termsBreachByReasonSnapshotToJson,
} from "./customerPolicyTrendTermsBreachByReason";
import { ensureCustomerCapacityGapStored } from "./syncCreditInsuranceGapPipeline";
import {
    computeCustomerDailyCostSnapshot,
    type CustomerDailyCostSnapshot,
    type TopUpForDailyCost,
} from "./customerPolicyDailyCost";
import {
    deriveDailyCostDeltaSnapshot,
    resolveGapFillDates,
} from "./customerPolicyDailyCostDelta";
import { hasTopUpPolicies } from "./hasTopUpPolicies";
import { resolveEffectiveApprovedLimit } from "./resolveEffectiveApprovedLimit";
import { computeTopUpUsageMetrics } from "./invoiceCapacityGapAmounts";

export type RiskExposurePolicySeries = {
    policyId: number;
    policyLabel: string;
    series: Array<{ snapshotDate: string; amount: number }>;
};

const COLLECTION_LIVE = ["Active", "Inactive"] as const;

export type CustomerPolicyTrendTopRow = {
    customerId: number;
    customerName: string;
    policyNumber: string | null;
    approvedLimit: number | null;
    topUpTotal: number | null;
    effectiveApprovedLimit: number | null;
    usageAmount: number;
    /** Policy limit usage % (sheet 2; capped at 100% when top-up applies). */
    policyUsagePct: number | null;
    /** Top-up pool usage % when AR exceeds approved limit. */
    topUpUsagePct: number | null;
    /** AR / effective limit × 100. */
    effectiveUsagePct: number | null;
    /** Bar segment widths (% of effective limit, or policy-only when no top-up). */
    barPolicyPct: number;
    barTopUpPct: number;
    barOverPct: number;
    /** Primary bar length / legacy field: effective usage when top-up exists, else policy usage. */
    usagePct: number | null;
};

export type CustomerPolicyUsageTrendResponse = {
    snapshotDate: string | null;
    hasTopUpPolicies: boolean;
    topCustomers: CustomerPolicyTrendTopRow[];
};

export type CustomerPolicyDailyCostChangeFields = {
    policyDailyCostChange: number | null;
    policyCostCurrency: string | null;
    topUpDailyCostChange: number | null;
    topUpCostCurrency: string | null;
    totalDailyCostChange: number | null;
    costCalculationMethod: cost_calculation_method | null;
    costPercent: number | null;
};

export type CustomerPolicyDailyCostKpiMetadata = {
    priorSnapshotDate: string | null;
    gapFillDaysApplied?: number;
};

export type CustomerPolicyDailyCostKpiPayload = CustomerPolicyDailyCostChangeFields &
    CustomerPolicyDailyCostKpiMetadata;

export type CustomerPolicyCustomerTrendPoint = {
    snapshotDate: string;
    usageAmount: number;
    approvedLimit: number | null;
    usagePct: number | null;
    registrationFeePercent: number | null;
} & CustomerPolicyDailyCostChangeFields;

export type CustomerPolicyCustomerTrendLatestPoint =
    CustomerPolicyCustomerTrendPoint & CustomerPolicyDailyCostKpiMetadata;

export type CustomerPolicyTrendRowForPoint = {
    snapshot_date: Date;
    usage_amount: number;
    approved_limit: Prisma.Decimal | null;
    usage_pct?: number | null;
    effective_usage_pct?: number | null;
    effective_approved_limit?: Prisma.Decimal | null;
    policy_daily_cost?: Prisma.Decimal | null;
    policy_cost_currency?: string | null;
    top_up_daily_cost?: Prisma.Decimal | null;
    top_up_cost_currency?: string | null;
    total_daily_cost?: Prisma.Decimal | null;
    cost_calculation_method?: cost_calculation_method | null;
    cost_percent?: Prisma.Decimal | null;
    registration_fee_percent?: Prisma.Decimal | null;
};

export type CustomerPolicyCustomerTrendResponse = {
    customerId: number;
    policyId: number | null;
    fromDate: string | null;
    toDate: string | null;
    latest: CustomerPolicyCustomerTrendLatestPoint | null;
    series: CustomerPolicyCustomerTrendPoint[];
};

export type CustomerPolicyPortfolioTrendPoint = {
    snapshotDate: string;
    totalUsageAmount: number;
    totalApprovedLimit: number;
    portfolioUsagePct: number | null;
    nearLimitCustomerCount: number;
    overLimitCustomerCount: number;
};

export type CustomerPolicyPortfolioTrendResponse = {
    fromDate: string | null;
    toDate: string | null;
    series: CustomerPolicyPortfolioTrendPoint[];
};

function startOfTodayUtc(): Date {
    const now = new Date();
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
}

function addUtcCalendarDays(base: Date, days: number): Date {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function normalizeDateString(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function addUtcDaysToDateString(dateStr: string, days: number): string {
    const [year, month, day] = dateStr.split("-").map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCDate(d.getUTCDate() + days);
    return normalizeDateString(d);
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
    if (value == null) {
        return null;
    }
    return new Prisma.Decimal(value).toNumber();
}

type PredecessorTrendCostContext = {
    snapshot_date: Date;
    usage_amount: number;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency: string | null;
    excluded_from_policy: boolean;
    outdated_dcl: boolean;
    cost_calculation_method: cost_calculation_method | null;
    cost_percent: Prisma.Decimal | null;
};

type PredecessorTrendRowKeyed = PredecessorTrendCostContext & {
    customer_id: number;
    insurance_policy_id: number | null;
};

function predecessorTrendKey(
    customerId: number,
    insurancePolicyId: number | null
): string {
    return `${customerId}:${insurancePolicyId ?? "null"}`;
}

function computeLevelsFromTrendContext(args: {
    policyInput: {
        costCalculationMethod: cost_calculation_method | null;
        costPercent: number | null;
        approvedLimit: number | null;
        usageAmount: number;
        limitCurrency: string;
        excludedFromPolicy: boolean;
        outdatedDcl: boolean;
    };
    activeTopUps: TopUpForDailyCost[];
    asOfDate: Date;
}): CustomerDailyCostSnapshot {
    return computeCustomerDailyCostSnapshot({
        policyInput: args.policyInput,
        activeTopUps: args.activeTopUps,
        asOfDate: args.asOfDate,
    });
}

async function fetchScopedTopUpsForCustomer(
    customerId: number,
    parentPrimaryPolicyId: number | null | undefined,
    asOfDate: Date
): Promise<TopUpForDailyCost[]> {
    const rows = await prisma.customerTopUp.findMany({
        where: {
            customer_id: customerId,
            cancelled_at: null,
            start_date: { lte: asOfDate },
            end_date: { gte: asOfDate },
            InsurancePolicy: {
                policy_kind: "TopUp",
            },
        },
        select: {
            premium: true,
            premium_currency: true,
            start_date: true,
            end_date: true,
            cancelled_at: true,
            InsurancePolicy: {
                select: {
                    parent_insurance_policy_id: true,
                },
            },
        },
    });

    return rows
        .filter(
            (row) =>
                parentPrimaryPolicyId == null ||
                row.InsurancePolicy.parent_insurance_policy_id ===
                    parentPrimaryPolicyId
        )
        .map((row) => ({
            premium: decimalToNumber(row.premium),
            premiumCurrency: row.premium_currency,
            startDate: row.start_date,
            endDate: row.end_date,
            cancelledAt: row.cancelled_at,
        }));
}

async function loadPredecessorTrendRowsByKey(
    accountId: number,
    snapshotDate: Date
): Promise<Map<string, PredecessorTrendCostContext>> {
    const priorDay = addUtcCalendarDays(snapshotDate, -1);

    const priorDayRows = await prisma.$queryRaw<PredecessorTrendRowKeyed[]>`
        SELECT
            t.snapshot_date,
            t.usage_amount,
            t.approved_limit,
            t.approved_limit_currency,
            t.excluded_from_policy,
            t.outdated_dcl,
            t.cost_calculation_method,
            t.cost_percent,
            t.customer_id,
            t.insurance_policy_id
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date = ${priorDay}::date
    `;

    const map = new Map<string, PredecessorTrendCostContext>();
    for (const row of priorDayRows) {
        map.set(
            predecessorTrendKey(row.customer_id, row.insurance_policy_id),
            row
        );
    }
    return map;
}

async function findFallbackPredecessorTrendRow(
    accountId: number,
    customerId: number,
    insurancePolicyId: number | null,
    snapshotDate: Date
): Promise<PredecessorTrendCostContext | null> {
    const rows = await prisma.$queryRaw<PredecessorTrendCostContext[]>`
        SELECT
            t.snapshot_date,
            t.usage_amount,
            t.approved_limit,
            t.approved_limit_currency,
            t.excluded_from_policy,
            t.outdated_dcl,
            t.cost_calculation_method,
            t.cost_percent
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.customer_id = ${customerId}
          AND t.snapshot_date < ${snapshotDate}::date
          AND (
            ${insurancePolicyId}::int IS NULL
            OR t.insurance_policy_id = ${insurancePolicyId}
          )
        ORDER BY t.snapshot_date DESC
        LIMIT 1
    `;

    return rows[0] ?? null;
}

async function resolvePredecessorLevels(args: {
    accountId: number;
    customerId: number;
    insurancePolicyId: number | null;
    snapshotDate: Date;
    limitCurrency: string;
    priorDayRowsByKey: Map<string, PredecessorTrendCostContext>;
}): Promise<CustomerDailyCostSnapshot | null> {
    const key = predecessorTrendKey(args.customerId, args.insurancePolicyId);
    let predecessorRow = args.priorDayRowsByKey.get(key) ?? null;
    if (!predecessorRow) {
        predecessorRow = await findFallbackPredecessorTrendRow(
            args.accountId,
            args.customerId,
            args.insurancePolicyId,
            args.snapshotDate
        );
    }
    if (!predecessorRow) {
        return null;
    }

    const activeTopUps = await fetchScopedTopUpsForCustomer(
        args.customerId,
        args.insurancePolicyId,
        predecessorRow.snapshot_date
    );

    return computeLevelsFromTrendContext({
        policyInput: {
            costCalculationMethod:
                predecessorRow.cost_calculation_method ?? null,
            costPercent: decimalToNumber(predecessorRow.cost_percent),
            approvedLimit: decimalToNumber(predecessorRow.approved_limit),
            usageAmount: Number(predecessorRow.usage_amount ?? 0),
            limitCurrency:
                predecessorRow.approved_limit_currency?.trim().toUpperCase() ||
                args.limitCurrency,
            excludedFromPolicy: predecessorRow.excluded_from_policy,
            outdatedDcl: predecessorRow.outdated_dcl,
        },
        activeTopUps,
        asOfDate: predecessorRow.snapshot_date,
    });
}

async function getAccountLatestSnapshotDate(
    accountId: number
): Promise<Date | null> {
    const rows = await prisma.$queryRaw<Array<{ snapshot_date: Date }>>`
        SELECT MAX(t.snapshot_date) AS snapshot_date
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
    `;
    return rows[0]?.snapshot_date ?? null;
}

function computeUsagePct(
    usageAmount: number,
    approvedLimit: number | null
): number | null {
    if (approvedLimit == null || approvedLimit <= 0) {
        return null;
    }
    return Math.min(999.99, (100 * usageAmount) / approvedLimit);
}

/**
 * Public API `usagePct` source: prefer snapshotted effective usage %, then legacy
 * `usage_pct`, then recompute from AR and limit columns on the trend row.
 */
export function resolveTrendRowUsagePct(row: {
    effective_usage_pct?: number | null;
    usage_pct?: number | null;
    usage_amount?: number;
    approved_limit?: Prisma.Decimal | null;
    effective_approved_limit?: Prisma.Decimal | null;
}): number | null {
    if (row.effective_usage_pct != null) {
        return Number(row.effective_usage_pct);
    }
    if (row.usage_pct != null) {
        return Number(row.usage_pct);
    }
    const limit = decimalToNumber(
        row.effective_approved_limit ?? row.approved_limit
    );
    return computeUsagePct(Number(row.usage_amount ?? 0), limit);
}

function resolveStoredUsagePct(
    stored: number | null | undefined,
    fallback: number | null
): number | null {
    if (stored != null) {
        return Number(stored);
    }
    return fallback;
}

export function mapDailyCostFieldsFromTrendRow(
    row: Pick<
        CustomerPolicyTrendRowForPoint,
        | "policy_daily_cost"
        | "policy_cost_currency"
        | "top_up_daily_cost"
        | "top_up_cost_currency"
        | "total_daily_cost"
        | "cost_calculation_method"
        | "cost_percent"
    >
): CustomerPolicyDailyCostChangeFields {
    return {
        policyDailyCostChange: decimalToNumber(row.policy_daily_cost),
        policyCostCurrency: row.policy_cost_currency?.trim() || null,
        topUpDailyCostChange: decimalToNumber(row.top_up_daily_cost),
        topUpCostCurrency: row.top_up_cost_currency?.trim() || null,
        totalDailyCostChange: decimalToNumber(row.total_daily_cost),
        costCalculationMethod: row.cost_calculation_method ?? null,
        costPercent: decimalToNumber(row.cost_percent),
    };
}

/**
 * Prior snapshot used as the delta baseline for {@link snapshotDate}.
 * Prefers the prior UTC calendar day when present in the series; otherwise the latest earlier date.
 */
export function resolvePriorSnapshotDateFromOrderedDates(
    orderedSnapshotDatesAsc: string[],
    snapshotDate: string
): string | null {
    const priorCalendarDay = addUtcDaysToDateString(snapshotDate, -1);
    if (orderedSnapshotDatesAsc.includes(priorCalendarDay)) {
        return priorCalendarDay;
    }

    let predecessor: string | null = null;
    for (const date of orderedSnapshotDatesAsc) {
        if (date >= snapshotDate) {
            break;
        }
        predecessor = date;
    }
    return predecessor;
}

/**
 * Infer how many UTC gap-fill days the account cron likely applied before today,
 * from distinct snapshot dates strictly before today.
 */
export function inferGapFillDaysAppliedFromRecentDates(
    snapshotDatesBeforeTodayAsc: Date[],
    todayUtc: Date
): number {
    if (snapshotDatesBeforeTodayAsc.length === 0) {
        return 0;
    }

    const dateSet = new Set(
        snapshotDatesBeforeTodayAsc.map((date) => normalizeDateString(date))
    );
    const yesterday = addUtcCalendarDays(todayUtc, -1);
    const yesterdayKey = normalizeDateString(yesterday);
    if (!dateSet.has(yesterdayKey)) {
        return 0;
    }

    let cursor = yesterday;
    while (dateSet.has(normalizeDateString(cursor))) {
        cursor = addUtcCalendarDays(cursor, -1);
    }
    const blockStart = addUtcCalendarDays(cursor, 1);
    const blockStartKey = normalizeDateString(blockStart);

    const anchorCandidates = snapshotDatesBeforeTodayAsc.filter(
        (date) => normalizeDateString(date) < blockStartKey
    );
    const anchor = anchorCandidates[anchorCandidates.length - 1];
    if (!anchor) {
        return 0;
    }

    const anchorKey = normalizeDateString(anchor);
    const expectedNextAfterAnchor = addUtcDaysToDateString(anchorKey, 1);
    if (expectedNextAfterAnchor === blockStartKey) {
        return 0;
    }

    const { datesToSync } = resolveGapFillDates({
        lastSnapshotDate: anchor,
        todayUtc,
    });
    return datesToSync.length;
}

async function lookupPriorSnapshotDateForCustomer(args: {
    accountId: number;
    customerId: number;
    snapshotDate: Date;
    policyId?: number;
}): Promise<string | null> {
    const priorDay = addUtcCalendarDays(args.snapshotDate, -1);
    const priorDayRows = await prisma.$queryRaw<Array<{ snapshot_date: Date }>>`
        SELECT t.snapshot_date
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${args.accountId}
          AND t.customer_id = ${args.customerId}
          AND t.snapshot_date = ${priorDay}::date
          AND (
            ${args.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${args.policyId ?? null}
          )
        LIMIT 1
    `;
    if (priorDayRows[0]) {
        return normalizeDateString(priorDayRows[0].snapshot_date);
    }

    const fallback = await findFallbackPredecessorTrendRow(
        args.accountId,
        args.customerId,
        args.policyId ?? null,
        args.snapshotDate
    );
    return fallback ? normalizeDateString(fallback.snapshot_date) : null;
}

async function resolveGapFillDaysAppliedForAccount(
    accountId: number,
    todayUtc: Date
): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ snapshot_date: Date }>>`
        SELECT DISTINCT snapshot_date
        FROM "CustomerPolicyTrend"
        WHERE account_id = ${accountId}
          AND snapshot_date < ${todayUtc}::date
        ORDER BY snapshot_date ASC
    `;
    return inferGapFillDaysAppliedFromRecentDates(
        rows.map((row) => row.snapshot_date),
        todayUtc
    );
}

async function buildDailyCostKpiMetadata(args: {
    accountId: number;
    customerId: number;
    snapshotDate: Date;
    policyId?: number;
    orderedSeriesDatesAsc?: string[];
}): Promise<CustomerPolicyDailyCostKpiMetadata> {
    const priorSnapshotDate =
        args.orderedSeriesDatesAsc != null
            ? resolvePriorSnapshotDateFromOrderedDates(
                  args.orderedSeriesDatesAsc,
                  normalizeDateString(args.snapshotDate)
              )
            : await lookupPriorSnapshotDateForCustomer({
                  accountId: args.accountId,
                  customerId: args.customerId,
                  snapshotDate: args.snapshotDate,
                  policyId: args.policyId,
              });

    const gapFillDaysApplied = await resolveGapFillDaysAppliedForAccount(
        args.accountId,
        args.snapshotDate
    );

    return {
        priorSnapshotDate,
        ...(gapFillDaysApplied > 0 ? { gapFillDaysApplied } : {}),
    };
}

export function mapCustomerPolicyTrendRowToPoint(
    row: CustomerPolicyTrendRowForPoint
): CustomerPolicyCustomerTrendPoint {
    const approvedLimit = decimalToNumber(row.approved_limit);
    const usageAmount = Number(row.usage_amount ?? 0);
    return {
        snapshotDate: normalizeDateString(row.snapshot_date),
        usageAmount,
        approvedLimit,
        usagePct: resolveTrendRowUsagePct({
            effective_usage_pct: row.effective_usage_pct,
            usage_pct: row.usage_pct,
            usage_amount: usageAmount,
            approved_limit: row.approved_limit,
            effective_approved_limit: row.effective_approved_limit,
        }),
        registrationFeePercent: decimalToNumber(row.registration_fee_percent),
        ...mapDailyCostFieldsFromTrendRow(row),
    };
}

export async function getCustomerDailyCostFromTrend(
    accountId: number,
    customerId: number,
    options?: { policyId?: number }
): Promise<CustomerPolicyDailyCostKpiPayload | null> {
    const snapshotDate = startOfTodayUtc();

    type CostRow = CustomerPolicyTrendRowForPoint;
    const rows = await prisma.$queryRaw<CostRow[]>`
        SELECT
            t.snapshot_date,
            t.usage_amount,
            t.approved_limit,
            t.usage_pct,
            t.effective_usage_pct,
            t.effective_approved_limit,
            t.policy_daily_cost,
            t.policy_cost_currency,
            t.top_up_daily_cost,
            t.top_up_cost_currency,
            t.total_daily_cost,
            t.cost_calculation_method,
            t.cost_percent,
            t.registration_fee_percent
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.customer_id = ${customerId}
          AND t.snapshot_date = ${snapshotDate}::date
          AND (
            ${options?.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options?.policyId ?? null}
          )
        ORDER BY t.snapshot_date DESC
        LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
        return null;
    }

    const metadata = await buildDailyCostKpiMetadata({
        accountId,
        customerId,
        snapshotDate,
        policyId: options?.policyId,
    });

    return {
        ...mapDailyCostFieldsFromTrendRow(row),
        ...metadata,
    };
}

/** Stacked bar segments for top-customer usage chart (policy / top-up / over effective). */
export function computeCustomerUsageBarSegments(args: {
    ar: number;
    approvedLimit: number | null;
    topUpTotal: number | null;
    hasTopUpPolicies: boolean;
}): {
    policyUsagePct: number | null;
    topUpUsagePct: number | null;
    effectiveUsagePct: number | null;
    barPolicyPct: number;
    barTopUpPct: number;
    barOverPct: number;
    usagePct: number | null;
} {
    const ar = Math.max(0, args.ar);
    const limit = Math.max(0, Number(args.approvedLimit ?? 0));
    const topUp = Math.max(0, Number(args.topUpTotal ?? 0));
    const hasTopUp = args.hasTopUpPolicies && topUp > 0 && limit > 0;

    if (!hasTopUp) {
        const policyUsagePct = computeUsagePct(ar, limit > 0 ? limit : null);
        const barPolicyPct = Math.max(0, policyUsagePct ?? 0);
        return {
            policyUsagePct,
            topUpUsagePct: null,
            effectiveUsagePct: policyUsagePct,
            barPolicyPct,
            barTopUpPct: 0,
            barOverPct: 0,
            usagePct: policyUsagePct,
        };
    }

    const metrics = computeTopUpUsageMetrics({
        ar,
        approvedLimit: limit,
        topUpTotal: topUp,
    });
    const effective = limit + topUp;
    const policyUsed = Math.min(ar, limit);
    const topUpUsed = Math.min(Math.max(0, ar - limit), topUp);
    const overEffective = Math.max(0, ar - effective);

    const barPolicyPct = effective > 0 ? (100 * policyUsed) / effective : 0;
    const barTopUpPct = effective > 0 ? (100 * topUpUsed) / effective : 0;
    const barOverPct = effective > 0 ? (100 * overEffective) / effective : 0;

    const policyUsagePct = Math.min(999.99, metrics.policyUsage * 100);
    const topUpUsagePct = Math.min(999.99, metrics.topUpUsage * 100);
    const effectiveUsagePct = Math.min(999.99, metrics.effectiveUsage * 100);

    return {
        policyUsagePct,
        topUpUsagePct,
        effectiveUsagePct,
        barPolicyPct,
        barTopUpPct,
        barOverPct,
        usagePct: effectiveUsagePct,
    };
}

function mapTrendRowToTopCustomer(
    r: {
        customer_id: number;
        usage_amount: number;
        approved_limit: Prisma.Decimal | null;
        usage_pct?: number | null;
        policy_usage_pct?: number | null;
        top_up_usage_pct?: number | null;
        effective_usage_pct?: number | null;
        top_up_total: number | null;
        effective_approved_limit: Prisma.Decimal | null;
        person_name: string | null;
        company_name: string | null;
        policy_number: string | null;
    },
    hasTopUpPolicies: boolean
): CustomerPolicyTrendTopRow {
    const approvedLimit = decimalToNumber(r.approved_limit);
    const topUpTotal =
        r.top_up_total != null && r.top_up_total > 0 ? Number(r.top_up_total) : null;
    const effectiveApprovedLimit = decimalToNumber(r.effective_approved_limit);
    const usageAmount = Number(r.usage_amount ?? 0);
    const segments = computeCustomerUsageBarSegments({
        ar: usageAmount,
        approvedLimit,
        topUpTotal,
        hasTopUpPolicies,
    });

    return {
        customerId: r.customer_id,
        customerName: r.person_name || r.company_name || "—",
        policyNumber: r.policy_number,
        approvedLimit,
        topUpTotal,
        effectiveApprovedLimit,
        usageAmount,
        policyUsagePct: resolveStoredUsagePct(
            r.policy_usage_pct,
            segments.policyUsagePct
        ),
        topUpUsagePct: resolveStoredUsagePct(
            r.top_up_usage_pct,
            segments.topUpUsagePct
        ),
        effectiveUsagePct: resolveStoredUsagePct(
            r.effective_usage_pct,
            segments.effectiveUsagePct
        ),
        barPolicyPct: segments.barPolicyPct,
        barTopUpPct: segments.barTopUpPct,
        barOverPct: segments.barOverPct,
        usagePct:
            resolveTrendRowUsagePct({
                effective_usage_pct: r.effective_usage_pct,
                usage_pct: r.usage_pct,
                usage_amount: usageAmount,
                approved_limit: r.approved_limit,
                effective_approved_limit: r.effective_approved_limit,
            }) ?? segments.usagePct,
    };
}

/**
 * Upsert {@link CustomerPolicyTrend} rows for one account as of `snapshotDate`
 * (payment-ledger open AR + Health family; top-ups/costs already date-bounded).
 */
export async function syncCustomerPolicyTrendSnapshotForAccount(
    accountId: number,
    options?: {
        policyId?: number;
        snapshotDate?: Date;
        customerIds?: number[];
        /** When set (e.g. shared backfill load), skip a second ledger query. */
        asOfLines?: AsOfOpenInvoiceLine[];
        /** Generate-job only: treat reporting-late as off in this snapshot. */
        ignoreReportingBreach?: boolean;
    }
): Promise<number> {
    const snapshotDate = options?.snapshotDate ?? startOfTodayUtc();
    let ledgerLines =
        options?.asOfLines ??
        (await loadAsOfOpenInvoiceCandidates(accountId, snapshotDate, {
            policyId: options?.policyId,
            customerIds: options?.customerIds,
        }));
    const openArByCustomer = buildAsOfOpenReceivableByCustomerMapFromLines(
        ledgerLines,
        snapshotDate
    );

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { currency: true },
    });
    const accountCurrency = account?.currency?.trim() || null;

    const activePolicies = await prisma.customerPolicy.findMany({
        where: {
            is_active: true,
            Customer: {
                account_id: accountId,
                collection_status: { in: [...COLLECTION_LIVE] },
                ...(options?.customerIds != null && options.customerIds.length > 0
                    ? { id: { in: options.customerIds } }
                    : {}),
            },
            ...(options?.policyId != null
                ? { insurance_policy_id: options.policyId }
                : {}),
        },
        select: {
            id: true,
            customer_id: true,
            insurance_policy_id: true,
            customer_number_policy: true,
            approved_limit: true,
            approved_limit_currency: true,
            approved_limit_expiration_date: true,
            limit_type: true,
            max_payment_term: true,
            max_allowed_mep: true,
            reporting_days: true,
            mep_cutoff_day_of_month: true,
            mep_substitute_day_of_month: true,
            reporting_cutoff_day_of_month: true,
            reporting_substitute_day_of_month: true,
            payment_term_cutoff_day_of_month: true,
            payment_term_substitute_day_of_month: true,
            excluded_from_policy: true,
            policy_exclusion_reason: true,
            credit_score: true,
            credit_score_input_date: true,
            active_customer_since: true,
            outdated_dcl: true,
            cost_percent: true,
            registration_fee_percent: true,
            capacity_gap_amount: true,
            capacity_gap_amount1: true,
            capacity_gap_currency1: true,
            capacity_gap_amount2: true,
            capacity_gap_currency2: true,
            Customer: {
                select: {
                    account_id: true,
                },
            },
            InsurancePolicy: {
                select: {
                    cost_calculation_method: true,
                    cost_percent: true,
                    end_date: true,
                },
            },
        },
    });

    const customerIds = Array.from(new Set(activePolicies.map((cp) => cp.customer_id)));
    const activeTopUpRows =
        customerIds.length > 0
            ? await prisma.customerTopUp.findMany({
                  where: {
                      customer_id: { in: customerIds },
                      cancelled_at: null,
                      start_date: { lte: snapshotDate },
                      end_date: { gte: snapshotDate },
                      InsurancePolicy: {
                          policy_kind: "TopUp",
                      },
                  },
                  select: {
                      customer_id: true,
                      premium: true,
                      premium_currency: true,
                      start_date: true,
                      end_date: true,
                      cancelled_at: true,
                      InsurancePolicy: {
                          select: {
                              parent_insurance_policy_id: true,
                          },
                      },
                  },
              })
            : [];

    const topUpsByCustomerId = new Map<
        number,
        Array<(typeof activeTopUpRows)[number]>
    >();
    for (const row of activeTopUpRows) {
        const bucket = topUpsByCustomerId.get(row.customer_id) ?? [];
        bucket.push(row);
        topUpsByCustomerId.set(row.customer_id, bucket);
    }

    const accountHasTopUp = await hasTopUpPolicies(accountId);
    const priorDayRowsByKey = await loadPredecessorTrendRowsByKey(
        accountId,
        snapshotDate
    );
    const CAPACITY_GAP_CONCURRENCY = 25;
    for (let i = 0; i < customerIds.length; i += CAPACITY_GAP_CONCURRENCY) {
        const batch = customerIds.slice(i, i + CAPACITY_GAP_CONCURRENCY);
        await Promise.all(
            batch.map((customerId) => ensureCustomerCapacityGapStored(customerId))
        );
    }

    const termsByCustomerAndPolicy = new Map<string, AsOfPolicyTermsForBreach>();
    for (const cp of activePolicies) {
        const terms: AsOfPolicyTermsForBreach = {
            maxPaymentTerm: cp.max_payment_term,
            maxAllowedMep: cp.max_allowed_mep,
            reportingDays: cp.reporting_days,
            mepCutoffDayOfMonth: cp.mep_cutoff_day_of_month,
            mepSubstituteDayOfMonth: cp.mep_substitute_day_of_month,
            reportingCutoffDayOfMonth: cp.reporting_cutoff_day_of_month,
            reportingSubstituteDayOfMonth: cp.reporting_substitute_day_of_month,
            paymentTermCutoffDayOfMonth: cp.payment_term_cutoff_day_of_month,
            paymentTermSubstituteDayOfMonth:
                cp.payment_term_substitute_day_of_month,
            policyEndDate: cp.InsurancePolicy?.end_date ?? null,
        };
        termsByCustomerAndPolicy.set(
            asOfTermsScopeKey(cp.customer_id, cp.insurance_policy_id),
            terms
        );
        const fallbackKey = asOfTermsScopeKey(cp.customer_id, null);
        if (!termsByCustomerAndPolicy.has(fallbackKey)) {
            termsByCustomerAndPolicy.set(fallbackKey, terms);
        }
    }
    ledgerLines = overlayAsOfTermsFlagsOnLines(
        ledgerLines,
        snapshotDate,
        termsByCustomerAndPolicy,
        { ignoreReportingBreach: options?.ignoreReportingBreach === true }
    );

    let rowsUpserted = 0;

    for (const cp of activePolicies) {
        const limitCurrency =
            cp.approved_limit_currency?.trim().toUpperCase() ||
            accountCurrency ||
            "USD";

        let usageAmount = 0;
        if (cp.insurance_policy_id != null) {
            usageAmount = Math.max(
                0,
                resolveAsOfOpenArOnPolicyInLimitCurrencyFromLines(
                    ledgerLines,
                    cp.customer_id,
                    cp.insurance_policy_id,
                    limitCurrency,
                    accountCurrency,
                    snapshotDate
                )
            );
        } else {
            usageAmount = Math.max(
                0,
                openArByCustomer.get(cp.customer_id) ?? 0
            );
        }

        const approvedLimit = decimalToNumber(cp.approved_limit);
        let topUpTotal: Prisma.Decimal | null = null;
        let activeTopUpCount: number | null = null;
        // Without top-ups (or when resolve fails), effective limit = base approved.
        // Portfolio Health utilization uses this field as the denominator.
        let effectiveApprovedLimit: Prisma.Decimal | null =
            cp.approved_limit != null
                ? new Prisma.Decimal(cp.approved_limit)
                : null;
        if (accountHasTopUp) {
            const resolved = await resolveEffectiveApprovedLimit(cp.customer_id, {
                baseApprovedLimit: cp.approved_limit,
                baseApprovedLimitCurrency:
                    cp.approved_limit_currency?.trim().toUpperCase() ?? null,
                dbClient: prisma,
                asOfDate: snapshotDate,
                parentPrimaryPolicyId: cp.insurance_policy_id ?? undefined,
            });
            if (resolved) {
                effectiveApprovedLimit = new Prisma.Decimal(
                    resolved.effectiveApprovedLimit ?? approvedLimit ?? 0
                );
                topUpTotal = new Prisma.Decimal(resolved.topUpTotalInLimitCurrency);
                activeTopUpCount = resolved.topUpByPolicy.reduce(
                    (s, p) => s + p.rows.length,
                    0
                );
            }
        }

        const policyScope = cp.insurance_policy_id ?? undefined;
        const uncovered = isUncoveredExposureCustomer({
            hasLinkedPolicy: hasActiveLinkedPolicy(cp.insurance_policy_id),
            exclusionReason: cp.policy_exclusion_reason,
        });
        const totalReceivables =
            policyScope != null
                ? sumAsOfOpenAmountFromLines(ledgerLines, snapshotDate, {
                      customerId: cp.customer_id,
                      policyId: policyScope,
                  })
                : Math.max(0, openArByCustomer.get(cp.customer_id) ?? 0);
        const flagBasedTermsBreach = sumAsOfTermsBreachFromLines(
            ledgerLines,
            snapshotDate,
            {
                customerId: cp.customer_id,
                ...(policyScope != null ? { policyId: policyScope } : {}),
            }
        );
        const flagBasedTermsBreachForAtRisk = flagBasedTermsBreach;
        const termsBreachInvoices = uncovered
            ? []
            : asOfTermsBreachInvoicesFromLines(
                  ledgerLines,
                  snapshotDate,
                  cp.customer_id,
                  cp.insurance_policy_id
              );
        const termsBreachByReason = uncovered
            ? { snapshot: {}, invoiceCount: 0 }
            : {
                  snapshot: aggregateTermsBreachByReasonFromInvoices(
                      termsBreachInvoices,
                      cp.insurance_policy_id
                  ),
                  invoiceCount: termsBreachInvoices.length,
              };
        const termsBreachOutstanding = uncovered
            ? totalReceivables
            : flagBasedTermsBreach;
        const termsBreachForAtRisk = uncovered
            ? totalReceivables
            : flagBasedTermsBreachForAtRisk;

        const financialPayload = buildCustomerPolicyTrendSnapshotPayload({
            accountCurrency,
            totalReceivables,
            capacityGapAmount: asOfCapacityGapAmount(
                totalReceivables,
                decimalToNumber(effectiveApprovedLimit),
                Boolean(cp.outdated_dcl)
            ),
            termsBreachOutstanding,
            termsBreachOutstandingForAtRisk: termsBreachForAtRisk,
            arInLimitCurrency: usageAmount,
            approvedLimit,
            topUpTotal:
                topUpTotal != null
                    ? new Prisma.Decimal(topUpTotal).toNumber()
                    : null,
        });

        if (!accountHasTopUp) {
            topUpTotal = null;
            activeTopUpCount = null;
        }

        const scopedTopUps = (topUpsByCustomerId.get(cp.customer_id) ?? []).filter(
            (row) =>
                cp.insurance_policy_id == null ||
                row.InsurancePolicy.parent_insurance_policy_id ===
                    cp.insurance_policy_id
        );
        const todayLevels = computeCustomerDailyCostSnapshot({
            policyInput: {
                costCalculationMethod:
                    cp.InsurancePolicy?.cost_calculation_method ?? null,
                costPercent: decimalToNumber(cp.InsurancePolicy?.cost_percent),
                approvedLimit,
                usageAmount,
                limitCurrency,
                excludedFromPolicy: cp.excluded_from_policy,
                outdatedDcl: cp.outdated_dcl,
            },
            activeTopUps: scopedTopUps.map((row) => ({
                premium: decimalToNumber(row.premium),
                premiumCurrency: row.premium_currency,
                startDate: row.start_date,
                endDate: row.end_date,
                cancelledAt: row.cancelled_at,
            })),
            asOfDate: snapshotDate,
        });
        const predecessorLevels = await resolvePredecessorLevels({
            accountId,
            customerId: cp.customer_id,
            insurancePolicyId: cp.insurance_policy_id,
            snapshotDate,
            limitCurrency,
            priorDayRowsByKey,
        });
        const costSnapshot = deriveDailyCostDeltaSnapshot({
            todayLevels,
            predecessorLevels,
        });
        const policyDailyCost =
            costSnapshot.policyDailyCost != null
                ? new Prisma.Decimal(costSnapshot.policyDailyCost)
                : null;
        const topUpDailyCost =
            costSnapshot.topUpDailyCost != null
                ? new Prisma.Decimal(costSnapshot.topUpDailyCost)
                : null;
        const totalDailyCost =
            costSnapshot.totalDailyCost != null
                ? new Prisma.Decimal(costSnapshot.totalDailyCost)
                : null;
        const snapshottedCostPercent =
            costSnapshot.costPercent != null
                ? new Prisma.Decimal(costSnapshot.costPercent)
                : null;

        await prisma.$executeRaw`
                INSERT INTO "CustomerPolicyTrend" (
                    account_id,
                    customer_id,
                    insurance_policy_id,
                    customer_policy_id,
                    snapshot_date,
                    approved_limit,
                    usage_amount,
                    top_up_total,
                    active_top_up_count,
                    effective_approved_limit,
                    customer_number_policy,
                    approved_limit_currency,
                    approved_limit_expiration_date,
                    limit_type,
                    max_payment_term,
                    max_allowed_mep,
                    reporting_days,
                    mep_cutoff_day_of_month,
                    mep_substitute_day_of_month,
                    reporting_cutoff_day_of_month,
                    reporting_substitute_day_of_month,
                    payment_term_cutoff_day_of_month,
                    payment_term_substitute_day_of_month,
                    excluded_from_policy,
                    policy_exclusion_reason,
                    credit_score,
                    credit_score_input_date,
                    active_customer_since,
                    outdated_dcl,
                    policy_daily_cost,
                    policy_cost_currency,
                    top_up_daily_cost,
                    top_up_cost_currency,
                    total_daily_cost,
                    cost_calculation_method,
                    cost_percent,
                    registration_fee_percent,
                    financial_currency,
                    total_receivables,
                    health_index,
                    at_risk_exposure,
                    compliant_exposure,
                    terms_breach_amount,
                    capacity_gap_amount,
                    terms_breach_count,
                    terms_breach_by_reason,
                    policy_usage_pct,
                    top_up_usage_pct,
                    effective_usage_pct
                ) VALUES (
                    ${cp.Customer.account_id},
                    ${cp.customer_id},
                    ${cp.insurance_policy_id},
                    ${cp.id},
                    ${snapshotDate}::date,
                    ${cp.approved_limit},
                    ${usageAmount},
                    ${topUpTotal},
                    ${activeTopUpCount},
                    ${effectiveApprovedLimit},
                    ${cp.customer_number_policy},
                    ${cp.approved_limit_currency},
                    ${cp.approved_limit_expiration_date},
                    ${cp.limit_type}::"customer_limit_type",
                    ${cp.max_payment_term},
                    ${cp.max_allowed_mep},
                    ${cp.reporting_days},
                    ${cp.mep_cutoff_day_of_month},
                    ${cp.mep_substitute_day_of_month},
                    ${cp.reporting_cutoff_day_of_month},
                    ${cp.reporting_substitute_day_of_month},
                    ${cp.payment_term_cutoff_day_of_month},
                    ${cp.payment_term_substitute_day_of_month},
                    ${cp.excluded_from_policy},
                    ${cp.policy_exclusion_reason},
                    ${cp.credit_score},
                    ${cp.credit_score_input_date},
                    ${cp.active_customer_since},
                    ${cp.outdated_dcl},
                    ${policyDailyCost},
                    ${costSnapshot.policyCostCurrency},
                    ${topUpDailyCost},
                    ${costSnapshot.topUpCostCurrency},
                    ${totalDailyCost},
                    ${costSnapshot.costCalculationMethod}::"cost_calculation_method",
                    ${snapshottedCostPercent},
                    ${cp.registration_fee_percent},
                    ${financialPayload.financialCurrency},
                    ${financialPayload.totalReceivables},
                    ${financialPayload.healthIndex},
                    ${financialPayload.atRiskExposure},
                    ${financialPayload.compliantExposure},
                    ${financialPayload.termsBreachAmount},
                    ${financialPayload.capacityGapAmount},
                    ${termsBreachByReason.invoiceCount},
                    ${termsBreachByReasonSnapshotToJson(termsBreachByReason.snapshot)}::jsonb,
                    ${financialPayload.policyUsagePct},
                    ${financialPayload.topUpUsagePct},
                    ${financialPayload.effectiveUsagePct}
                )
                ON CONFLICT (customer_id, customer_policy_id, snapshot_date)
                DO UPDATE SET
                    account_id = EXCLUDED.account_id,
                    insurance_policy_id = EXCLUDED.insurance_policy_id,
                    approved_limit = EXCLUDED.approved_limit,
                    usage_amount = EXCLUDED.usage_amount,
                    top_up_total = EXCLUDED.top_up_total,
                    active_top_up_count = EXCLUDED.active_top_up_count,
                    effective_approved_limit = EXCLUDED.effective_approved_limit,
                    customer_number_policy = EXCLUDED.customer_number_policy,
                    approved_limit_currency = EXCLUDED.approved_limit_currency,
                    approved_limit_expiration_date = EXCLUDED.approved_limit_expiration_date,
                    limit_type = EXCLUDED.limit_type,
                    max_payment_term = EXCLUDED.max_payment_term,
                    max_allowed_mep = EXCLUDED.max_allowed_mep,
                    reporting_days = EXCLUDED.reporting_days,
                    mep_cutoff_day_of_month = EXCLUDED.mep_cutoff_day_of_month,
                    mep_substitute_day_of_month = EXCLUDED.mep_substitute_day_of_month,
                    reporting_cutoff_day_of_month = EXCLUDED.reporting_cutoff_day_of_month,
                    reporting_substitute_day_of_month = EXCLUDED.reporting_substitute_day_of_month,
                    payment_term_cutoff_day_of_month = EXCLUDED.payment_term_cutoff_day_of_month,
                    payment_term_substitute_day_of_month = EXCLUDED.payment_term_substitute_day_of_month,
                    excluded_from_policy = EXCLUDED.excluded_from_policy,
                    policy_exclusion_reason = EXCLUDED.policy_exclusion_reason,
                    credit_score = EXCLUDED.credit_score,
                    credit_score_input_date = EXCLUDED.credit_score_input_date,
                    active_customer_since = EXCLUDED.active_customer_since,
                    outdated_dcl = EXCLUDED.outdated_dcl,
                    policy_daily_cost = EXCLUDED.policy_daily_cost,
                    policy_cost_currency = EXCLUDED.policy_cost_currency,
                    top_up_daily_cost = EXCLUDED.top_up_daily_cost,
                    top_up_cost_currency = EXCLUDED.top_up_cost_currency,
                    total_daily_cost = EXCLUDED.total_daily_cost,
                    cost_calculation_method = EXCLUDED.cost_calculation_method,
                    cost_percent = EXCLUDED.cost_percent,
                    registration_fee_percent = EXCLUDED.registration_fee_percent,
                    financial_currency = EXCLUDED.financial_currency,
                    total_receivables = EXCLUDED.total_receivables,
                    health_index = EXCLUDED.health_index,
                    at_risk_exposure = EXCLUDED.at_risk_exposure,
                    compliant_exposure = EXCLUDED.compliant_exposure,
                    terms_breach_amount = EXCLUDED.terms_breach_amount,
                    capacity_gap_amount = EXCLUDED.capacity_gap_amount,
                    terms_breach_count = EXCLUDED.terms_breach_count,
                    terms_breach_by_reason = EXCLUDED.terms_breach_by_reason,
                    policy_usage_pct = EXCLUDED.policy_usage_pct,
                    top_up_usage_pct = EXCLUDED.top_up_usage_pct,
                    effective_usage_pct = EXCLUDED.effective_usage_pct,
                    modified_at = NOW()
            `;
        rowsUpserted += 1;
    }

    return rowsUpserted;
}

/**
 * Upsert one daily row per customer with an active {@link CustomerPolicy} on credit-insurance accounts.
 */
export type CustomerPolicyTrendSnapshotRunResult = {
    accountsProcessed: number;
    rowsUpserted: number;
    gapFillWarnings: Array<{
        accountId: number;
        gapDays: number;
        gapFillDaysApplied: number;
    }>;
};

export async function takeCustomerPolicyTrendSnapshots(): Promise<CustomerPolicyTrendSnapshotRunResult> {
    const accounts = await prisma.account.findMany({
        where: { has_credit_insurance: true },
        select: { id: true },
    });

    const todayUtc = startOfTodayUtc();
    let rowsUpserted = 0;
    const gapFillWarnings: CustomerPolicyTrendSnapshotRunResult["gapFillWarnings"] =
        [];

    for (const account of accounts) {
        const lastSnapshotDate = await getAccountLatestSnapshotDate(account.id);
        const { datesToSync, gapDays, gapExceedsCap } = resolveGapFillDates({
            lastSnapshotDate,
            todayUtc,
        });

        if (gapExceedsCap) {
            gapFillWarnings.push({
                accountId: account.id,
                gapDays,
                gapFillDaysApplied: datesToSync.length,
            });
        }

        for (const gapDate of datesToSync) {
            rowsUpserted += await syncCustomerPolicyTrendSnapshotForAccount(
                account.id,
                { snapshotDate: gapDate }
            );
        }

        rowsUpserted += await syncCustomerPolicyTrendSnapshotForAccount(
            account.id,
            { snapshotDate: todayUtc }
        );
    }

    return {
        accountsProcessed: accounts.length,
        rowsUpserted,
        gapFillWarnings,
    };
}

/**
 * Top N customers by current AR / usage amount on the latest snapshot day.
 * Includes approved limit and usage % so the UI can compare both amount and percent.
 */
export async function getCustomerPolicyUsageTrend(
    accountId: number,
    options?: {
        policyId?: number;
        limit?: number;
        businessUnitFilter?: Prisma.CustomerWhereInput;
    }
): Promise<CustomerPolicyUsageTrendResponse> {
    const topN = Math.min(50, Math.max(1, options?.limit ?? 10));
    const snapshotDate = startOfTodayUtc();
    const hasTopUpPoliciesFlag = await hasTopUpPolicies(accountId);

    await syncCustomerPolicyTrendSnapshotForAccount(accountId, {
        policyId: options?.policyId,
        snapshotDate,
    });

    const dateStr = normalizeDateString(snapshotDate);

    const scopedCustomerIds =
        options?.businessUnitFilter &&
        Object.keys(options.businessUnitFilter).length > 0
            ? (
                  await prisma.customer.findMany({
                      where: {
                          account_id: accountId,
                          AND: [options.businessUnitFilter],
                      },
                      select: { id: true },
                  })
              ).map((row) => row.id)
            : null;

    if (scopedCustomerIds?.length === 0) {
        return {
            snapshotDate: dateStr,
            hasTopUpPolicies: hasTopUpPoliciesFlag,
            topCustomers: [],
        };
    }

    type TrendRow = {
        customer_id: number;
        insurance_policy_id: number | null;
        approved_limit: Prisma.Decimal | null;
        usage_amount: number;
        usage_pct: number | null;
        policy_usage_pct: number | null;
        top_up_usage_pct: number | null;
        effective_usage_pct: number | null;
        top_up_total: number | null;
        effective_approved_limit: Prisma.Decimal | null;
        person_name: string | null;
        company_name: string | null;
        policy_number: string | null;
    };

    const rows = await prisma.$queryRaw<TrendRow[]>`
        SELECT
          t.customer_id,
          t.insurance_policy_id,
          t.approved_limit,
          t.usage_amount,
          t.usage_pct,
          t.policy_usage_pct,
          t.top_up_usage_pct,
          t.effective_usage_pct,
          t.top_up_total,
          t.effective_approved_limit,
          p.full_name AS person_name,
          co.name AS company_name,
          ip.policy_number
        FROM "CustomerPolicyTrend" t
        INNER JOIN "Customer" c ON c.id = t.customer_id
        LEFT JOIN "Person" p ON p.id = c.person_id
        LEFT JOIN "Company" co ON co.id = c.company_id
        LEFT JOIN "InsurancePolicy" ip ON ip.id = t.insurance_policy_id
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date = ${snapshotDate}::date
          AND (
            ${options?.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options?.policyId ?? null}
          )
          AND (
            ${scopedCustomerIds == null}::boolean
            OR t.customer_id = ANY(${scopedCustomerIds ?? []}::int[])
          )
        ORDER BY
          t.usage_amount DESC,
          COALESCE(
            t.effective_usage_pct,
            t.usage_pct,
            CASE
              WHEN COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
                THEN (t.usage_amount / COALESCE(t.effective_approved_limit, t.approved_limit)::float) * 100
              ELSE 0
            END
          ) DESC,
          t.customer_id ASC
        LIMIT ${topN}
    `;

    const topCustomers: CustomerPolicyTrendTopRow[] = rows.map((r) =>
        mapTrendRowToTopCustomer(r, hasTopUpPoliciesFlag)
    );

    return {
        snapshotDate: dateStr,
        hasTopUpPolicies: hasTopUpPoliciesFlag,
        topCustomers,
    };
}

export async function getCustomerPolicyTrendForCustomer(
    accountId: number,
    customerId: number,
    options?: { policyId?: number; days?: number }
): Promise<CustomerPolicyCustomerTrendResponse> {
    const safeDays = Math.max(7, Math.min(options?.days ?? 90, 365));
    const toDateUtc = startOfTodayUtc();
    const fromDateUtc = addUtcCalendarDays(toDateUtc, -(safeDays - 1));

    const rows = await prisma.$queryRaw<CustomerPolicyTrendRowForPoint[]>`
        SELECT
            t.snapshot_date,
            t.usage_amount,
            t.approved_limit,
            t.usage_pct,
            t.effective_usage_pct,
            t.effective_approved_limit,
            t.policy_daily_cost,
            t.policy_cost_currency,
            t.top_up_daily_cost,
            t.top_up_cost_currency,
            t.total_daily_cost,
            t.cost_calculation_method,
            t.cost_percent,
            t.registration_fee_percent
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.customer_id = ${customerId}
          AND t.snapshot_date >= ${fromDateUtc}::date
          AND t.snapshot_date <= ${toDateUtc}::date
          AND (
            ${options?.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options?.policyId ?? null}
          )
        ORDER BY t.snapshot_date ASC
    `;

    if (rows.length === 0) {
        return {
            customerId,
            policyId: options?.policyId ?? null,
            fromDate: null,
            toDate: null,
            latest: null,
            series: [],
        };
    }

    const series: CustomerPolicyCustomerTrendPoint[] = rows.map((row) =>
        mapCustomerPolicyTrendRowToPoint(row)
    );

    const latestPoint = series[series.length - 1] ?? null;
    let latest: CustomerPolicyCustomerTrendLatestPoint | null = null;
    if (latestPoint) {
        const metadata = await buildDailyCostKpiMetadata({
            accountId,
            customerId,
            snapshotDate: new Date(`${latestPoint.snapshotDate}T00:00:00.000Z`),
            policyId: options?.policyId,
            orderedSeriesDatesAsc: series.map((point) => point.snapshotDate),
        });
        latest = { ...latestPoint, ...metadata };
    }

    return {
        customerId,
        policyId: options?.policyId ?? null,
        fromDate: series[0]?.snapshotDate ?? null,
        toDate: series[series.length - 1]?.snapshotDate ?? null,
        latest,
        series,
    };
}

/**
 * Daily portfolio limit usage from {@link CustomerPolicyTrend} (sum AR vs sum limits per day).
 */
export async function getCustomerPolicyPortfolioTrend(
    accountId: number,
    options?: { policyId?: number; days?: number }
): Promise<CustomerPolicyPortfolioTrendResponse> {
    const safeDays = Math.max(2, Math.min(options?.days ?? 30, 90));
    const toDateUtc = startOfTodayUtc();
    const fromDateUtc = addUtcCalendarDays(toDateUtc, -(safeDays - 1));

    type TrendAggRow = {
        snapshot_date: Date;
        total_usage: number;
        total_limit: Prisma.Decimal | null;
        near_limit_count: bigint;
        over_limit_count: bigint;
    };

    const rows = await prisma.$queryRaw<TrendAggRow[]>`
        SELECT
            t.snapshot_date,
            SUM(t.usage_amount)::float AS total_usage,
            SUM(t.approved_limit) AS total_limit,
            COUNT(*) FILTER (
                WHERE COALESCE(t.effective_usage_pct, t.usage_pct) >= 80
                  AND COALESCE(t.effective_usage_pct, t.usage_pct) < 100
            )::bigint AS near_limit_count,
            COUNT(*) FILTER (
                WHERE EXISTS (
                    SELECT 1
                    FROM "CustomerPolicy" cp
                    WHERE cp.customer_id = t.customer_id
                      AND cp.insurance_policy_id IS NOT DISTINCT FROM t.insurance_policy_id
                      AND cp.is_active = true
                      AND COALESCE(cp.capacity_gap_amount1, 0) > 0
                )
            )::bigint AS over_limit_count
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date >= ${fromDateUtc}::date
          AND t.snapshot_date <= ${toDateUtc}::date
          AND (
            ${options?.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options?.policyId ?? null}
          )
        GROUP BY t.snapshot_date
        ORDER BY t.snapshot_date ASC
    `;

    if (rows.length === 0) {
        return { fromDate: null, toDate: null, series: [] };
    }

    const series: CustomerPolicyPortfolioTrendPoint[] = rows.map((r) => {
        const totalUsageAmount = Number(r.total_usage ?? 0);
        const totalApprovedLimit = decimalToNumber(r.total_limit) ?? 0;
        const portfolioUsagePct =
            totalApprovedLimit > 0
                ? Math.min(
                      999.99,
                      (100 * totalUsageAmount) / totalApprovedLimit
                  )
                : null;

        return {
            snapshotDate: normalizeDateString(r.snapshot_date),
            totalUsageAmount,
            totalApprovedLimit,
            portfolioUsagePct,
            nearLimitCustomerCount: Number(r.near_limit_count ?? 0),
            overLimitCustomerCount: Number(r.over_limit_count ?? 0),
        };
    });

    return {
        fromDate: series[0]!.snapshotDate,
        toDate: series[series.length - 1]!.snapshotDate,
        series,
    };
}

/**
 * Per-policy risk exposure amount over time from {@link CustomerPolicyTrend} snapshots.
 * Amount at each point = min(usage AR, capacity gap from limit + terms breach outstanding).
 */
export async function getCustomerRiskExposureAmountTrendByPolicy(
    accountId: number,
    customerId: number,
    options?: {
        policyId?: number;
        days?: number;
        termsBreachOutstanding?: number;
    }
): Promise<RiskExposurePolicySeries[]> {
    const safeDays = Math.max(7, Math.min(options?.days ?? 90, 365));
    const toDateUtc = startOfTodayUtc();
    const fromDateUtc = addUtcCalendarDays(toDateUtc, -(safeDays - 1));
    const termsBreach = Math.max(0, options?.termsBreachOutstanding ?? 0);

    const policyGapRows = await prisma.customerPolicy.findMany({
        where: {
            customer_id: customerId,
            Customer: { account_id: accountId },
            ...(options?.policyId != null
                ? { insurance_policy_id: options.policyId }
                : {}),
        },
        select: {
            insurance_policy_id: true,
            capacity_gap_amount: true,
            approved_limit: true,
            outdated_dcl: true,
            is_active: true,
            modified_at: true,
            id: true,
        },
        orderBy: [
            { is_active: "desc" },
            { modified_at: "desc" },
            { id: "desc" },
        ],
    });
    const gapByPolicyId = new Map<number, number>();
    for (const row of policyGapRows) {
        const pid = row.insurance_policy_id;
        if (pid == null || gapByPolicyId.has(pid)) {
            continue;
        }
        gapByPolicyId.set(pid, storedCapacityGapAmount(row));
    }

    type TrendRow = {
        snapshot_date: Date;
        insurance_policy_id: number | null;
        usage_amount: number;
        approved_limit: Prisma.Decimal | null;
        policy_number: string | null;
    };

    const rows = await prisma.$queryRaw<TrendRow[]>`
        SELECT
            t.snapshot_date,
            t.insurance_policy_id,
            t.usage_amount,
            t.approved_limit,
            ip.policy_number
        FROM "CustomerPolicyTrend" t
        LEFT JOIN "InsurancePolicy" ip ON ip.id = t.insurance_policy_id
        WHERE t.account_id = ${accountId}
          AND t.customer_id = ${customerId}
          AND t.snapshot_date >= ${fromDateUtc}::date
          AND t.snapshot_date <= ${toDateUtc}::date
          AND t.insurance_policy_id IS NOT NULL
          AND (
            ${options?.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options?.policyId ?? null}
          )
        ORDER BY t.snapshot_date ASC, t.insurance_policy_id ASC
    `;

    const dateKeys: string[] = [];
    for (let i = 0; i < safeDays; i++) {
        dateKeys.push(normalizeDateString(addUtcCalendarDays(fromDateUtc, i)));
    }

    const byPolicy = new Map<
        number,
        { policyLabel: string; points: Map<string, number> }
    >();

    for (const row of rows) {
        const policyId = row.insurance_policy_id;
        if (policyId == null) {
            continue;
        }
        const usageAmount = Math.max(0, Number(row.usage_amount ?? 0));
        const capacityGapAmount = gapByPolicyId.get(policyId) ?? 0;
        const amount = computeCustomerRiskExposure({
            totalAr: usageAmount,
            capacityGapAmount,
            termsBreachOutstanding: termsBreach,
        });
        const dateStr = normalizeDateString(row.snapshot_date);
        const label =
            row.policy_number?.trim() || `Policy #${policyId}`;
        let bucket = byPolicy.get(policyId);
        if (!bucket) {
            bucket = { policyLabel: label, points: new Map() };
            byPolicy.set(policyId, bucket);
        }
        bucket.points.set(dateStr, amount);
    }

    if (byPolicy.size === 0) {
        const zeroSeries = (pid: number, label: string): RiskExposurePolicySeries => ({
            policyId: pid,
            policyLabel: label,
            series: dateKeys.map((snapshotDate) => ({
                snapshotDate,
                amount: 0,
            })),
        });

        const policyId = options?.policyId;
        if (policyId != null) {
            const ip = await prisma.insurancePolicy.findFirst({
                where: { id: policyId, account_id: accountId },
                select: { policy_number: true },
            });
            return [
                zeroSeries(
                    policyId,
                    ip?.policy_number?.trim() || `Policy #${policyId}`
                ),
            ];
        }

        const activePolicies = await prisma.customerPolicy.findMany({
            where: {
                customer_id: customerId,
                is_active: true,
                insurance_policy_id: { not: null },
                Customer: { account_id: accountId },
            },
            select: {
                insurance_policy_id: true,
                InsurancePolicy: { select: { policy_number: true } },
            },
        });
        if (activePolicies.length === 0) {
            return [zeroSeries(0, "")];
        }
        return activePolicies
            .filter((p) => p.insurance_policy_id != null)
            .map((p) =>
                zeroSeries(
                    p.insurance_policy_id!,
                    p.InsurancePolicy?.policy_number?.trim() ||
                        `Policy #${p.insurance_policy_id}`
                )
            );
    }

    return Array.from(byPolicy.entries()).map(([policyId, bucket]) => ({
        policyId,
        policyLabel: bucket.policyLabel,
        series: dateKeys.map((snapshotDate) => ({
            snapshotDate,
            amount: bucket.points.get(snapshotDate) ?? 0,
        })),
    }));
}
