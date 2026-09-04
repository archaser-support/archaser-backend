import { cost_calculation_method, Prisma, type customer_limit_type } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";

import { resolveInvoicePaidTolerance } from "./resolveInvoicePaidTolerance";
import { resolveMepBreachStartDate } from "./resolveMepBreachStartDate";
import { hasTopUpPolicies } from "./hasTopUpPolicies";
import {
    isActiveTopUp,
    type TopUpRowForResolution,
} from "./resolveEffectiveApprovedLimit";
import {
    isPrimaryPolicyEffectivelyActive,
    isTopUpInsurancePolicyEffectivelyActive,
} from "./shared/insurancePolicyLifecycle";

const COLLECTION_LIVE = ["Active", "Inactive"] as const;

/** Cost fields from the prior calendar day, cached during multi-day replay. */
export type TrendCostPredecessorRow = {
    snapshot_date: Date;
    usage_amount: number;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency: string | null;
    excluded_from_policy: boolean;
    outdated_dcl: boolean;
    cost_calculation_method: cost_calculation_method | null;
    cost_percent: Prisma.Decimal | null;
};

/** Top-up rows preloaded for a replay date range (Generate / drain). */
export type TopUpRowForTrendReplay = TopUpRowForResolution & {
    customer_id: number;
    premium: Prisma.Decimal | null;
    premium_currency: string | null;
};

/** Active {@link CustomerPolicy} rows loaded once per Generate / drain replay run. */
export type ActiveCustomerPolicyForTrendSync = {
    id: number;
    customer_id: number;
    insurance_policy_id: number | null;
    customer_number_policy: string | null;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency: string | null;
    approved_limit_expiration_date: Date | null;
    limit_type: customer_limit_type | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
    mep_cutoff_day_of_month: number | null;
    mep_substitute_day_of_month: number | null;
    reporting_cutoff_day_of_month: number | null;
    reporting_substitute_day_of_month: number | null;
    payment_term_cutoff_day_of_month: number | null;
    payment_term_substitute_day_of_month: number | null;
    excluded_from_policy: boolean;
    policy_exclusion_reason: string | null;
    credit_score: Prisma.Decimal | null;
    credit_score_input_date: Date | null;
    active_customer_since: Date | null;
    outdated_dcl: boolean;
    cost_percent: Prisma.Decimal | null;
    registration_fee_percent: Prisma.Decimal | null;
    capacity_gap_amount: number | null;
    capacity_gap_amount1: number | null;
    capacity_gap_currency1: string | null;
    capacity_gap_amount2: number | null;
    capacity_gap_currency2: string | null;
    Customer: { account_id: number };
    InsurancePolicy: {
        cost_calculation_method: cost_calculation_method | null;
        cost_percent: Prisma.Decimal | null;
        end_date: Date | null;
    } | null;
};

type CachedInsurancePolicy = {
    id: number;
    policy_kind: string;
    status: string;
    start_date: Date;
    end_date: Date;
    parent_insurance_policy_id: number | null;
    ParentInsurancePolicy: {
        status: string;
        start_date: Date;
        end_date: Date;
    } | null;
};

export type CreditDashboardSnapshotScope = {
    accountId: number;
    policyId: number | null;
    businessUnitId: number | null;
};

/** Account warning thresholds loaded once per Generate / replay run. */
export type CreditDashboardAccountSettings = {
    accountCurrency: string;
    customerLimitExpirationWarningDays: number;
    reportingDateWarningDays: number;
    creditLimitWarningThresholdPct: number;
    creditScoreValidityWarningDays: number;
};

const DEFAULT_REPORTING_WINDOW_DAYS = 14;
const DEFAULT_LIMIT_WARN_THRESHOLD_PCT = 80;
const DEFAULT_SCORE_VALIDITY_WARN_DAYS = 30;

export function resolveCreditDashboardAccountSettings(account: {
    currency: string | null;
    customer_limit_expiration_warning_days: number | null;
    reporting_date_warning_days: number | null;
    credit_limit_warning_threshold_pct: number | null;
    credit_score_validity_warning_days: number | null;
} | null): CreditDashboardAccountSettings {
    return {
        accountCurrency:
            account?.currency && String(account.currency).trim()
                ? String(account.currency).trim().toUpperCase()
                : "USD",
        reportingDateWarningDays: Math.max(
            0,
            account?.reporting_date_warning_days ?? DEFAULT_REPORTING_WINDOW_DAYS
        ),
        creditLimitWarningThresholdPct: Math.min(
            100,
            Math.max(
                1,
                account?.credit_limit_warning_threshold_pct ??
                    DEFAULT_LIMIT_WARN_THRESHOLD_PCT
            )
        ),
        creditScoreValidityWarningDays: Math.max(
            0,
            account?.credit_score_validity_warning_days ??
                DEFAULT_SCORE_VALIDITY_WARN_DAYS
        ),
        customerLimitExpirationWarningDays: Math.max(
            0,
            account?.customer_limit_expiration_warning_days ?? 0
        ),
    };
}

/**
 * Static account inputs resolved once per Generate / multi-day replay run and
 * threaded through CPT sync and dashboard snapshot writers.
 */
export type CreditAsOfBackfillRunContext = {
    accountId: number;
    accountCurrency: string | null;
    /** Warning thresholds for dashboard summary (avoids per-scope account reads). */
    dashboardAccountSettings?: CreditDashboardAccountSettings;
    invoicePaidTolerance: number | null;
    hasTopUpPolicies: boolean;
    mepBreachStartDate: Date | null;
    activeCustomerPolicies: ActiveCustomerPolicyForTrendSync[];
    insurancePolicies: CachedInsurancePolicy[];
    businessUnitIds: number[];
    /** True after {@link ensureCapacityGapsForBackfillRun} completes. */
    capacityGapEnsured: boolean;
    /** Top-ups overlapping replay range, keyed by customer_id. */
    topUpsByCustomerId?: Map<number, TopUpRowForTrendReplay[]>;
    /**
     * Prior calendar day's CPT cost inputs from the last replayed day.
     * Avoids re-reading CustomerPolicyTrend between sequential replay days.
     */
    priorDayTrendCostByKey?: Map<string, TrendCostPredecessorRow>;
};

function isPolicyEffectivelyActiveOnDate(
    policy: CachedInsurancePolicy,
    asOfDate: Date
): boolean {
    if (policy.policy_kind === "Primary") {
        return isPrimaryPolicyEffectivelyActive({
            status: policy.status,
            startDate: policy.start_date,
            endDate: policy.end_date,
            todayUtc: asOfDate,
        });
    }
    if (policy.policy_kind === "TopUp") {
        const parent = policy.ParentInsurancePolicy;
        return isTopUpInsurancePolicyEffectivelyActive({
            topUpStatus: policy.status,
            parentPolicyId: policy.parent_insurance_policy_id,
            parentStatus: parent?.status ?? null,
            parentStartDate: parent?.start_date ?? null,
            parentEndDate: parent?.end_date ?? null,
            todayUtc: asOfDate,
        });
    }
    return false;
}

export async function loadActiveCustomerPoliciesForTrendSync(
    accountId: number,
    options?: {
        policyId?: number;
        customerIds?: number[];
        dbClient?: DbClient;
    }
): Promise<ActiveCustomerPolicyForTrendSync[]> {
    const db = options?.dbClient ?? defaultPrisma;
    return db.customerPolicy.findMany({
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
}

async function loadInsurancePoliciesForAccount(
    accountId: number,
    dbClient?: DbClient
): Promise<CachedInsurancePolicy[]> {
    const db = dbClient ?? defaultPrisma;
    return db.insurancePolicy.findMany({
        where: { account_id: accountId },
        select: {
            id: true,
            policy_kind: true,
            status: true,
            start_date: true,
            end_date: true,
            parent_insurance_policy_id: true,
            ParentInsurancePolicy: {
                select: {
                    status: true,
                    start_date: true,
                    end_date: true,
                },
            },
        },
    });
}

async function loadTopUpsForReplayRange(
    accountId: number,
    customerIds: number[],
    fromDate: Date,
    toDate: Date,
    db: DbClient
): Promise<Map<number, TopUpRowForTrendReplay[]>> {
    const map = new Map<number, TopUpRowForTrendReplay[]>();
    if (customerIds.length === 0) {
        return map;
    }
    const rows = (await db.customerTopUp.findMany({
        where: {
            customer_id: { in: customerIds },
            cancelled_at: null,
            start_date: { lte: toDate },
            end_date: { gte: fromDate },
            InsurancePolicy: {
                policy_kind: "TopUp",
            },
        },
        select: {
            id: true,
            customer_id: true,
            top_up_type: true,
            top_up_value: true,
            currency: true,
            premium: true,
            premium_currency: true,
            start_date: true,
            end_date: true,
            cancelled_at: true,
            InsurancePolicy: {
                select: {
                    id: true,
                    allow_concurrent_top_ups: true,
                    parent_insurance_policy_id: true,
                },
            },
        },
    })) as TopUpRowForTrendReplay[];
    for (const row of rows) {
        const bucket = map.get(row.customer_id) ?? [];
        bucket.push(row);
        map.set(row.customer_id, bucket);
    }
    return map;
}

/** Active top-up rows for one customer on an as-of date from a preloaded range map. */
export function scopedTopUpsFromReplayPreload(
    topUpsByCustomerId: Map<number, TopUpRowForTrendReplay[]> | undefined,
    customerId: number,
    parentPrimaryPolicyId: number | null | undefined,
    asOfDate: Date
): TopUpRowForTrendReplay[] {
    if (!topUpsByCustomerId) {
        return [];
    }
    return (topUpsByCustomerId.get(customerId) ?? [])
        .filter((row) => isActiveTopUp(row, asOfDate))
        .filter(
            (row) =>
                parentPrimaryPolicyId == null ||
                row.InsurancePolicy.parent_insurance_policy_id ===
                    parentPrimaryPolicyId
        );
}

export function topUpsByCustomerForSnapshotDate(
    allTopUps: Map<number, TopUpRowForTrendReplay[]>,
    customerIds: number[],
    snapshotDate: Date
): Map<number, TopUpRowForTrendReplay[]> {
    const map = new Map<number, TopUpRowForTrendReplay[]>();
    for (const customerId of customerIds) {
        const active = (allTopUps.get(customerId) ?? []).filter((row) =>
            isActiveTopUp(row, snapshotDate)
        );
        if (active.length > 0) {
            map.set(customerId, active);
        }
    }
    return map;
}

async function loadActiveBusinessUnitIds(
    accountId: number,
    dbClient?: DbClient
): Promise<number[]> {
    const db = dbClient ?? defaultPrisma;
    const rows = await db.businessUnit.findMany({
        where: {
            account_id: accountId,
            status: "Active",
        },
        select: { id: true },
        orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
}

/** Derive dashboard snapshot scopes for one UTC day from cached insurance policies. */
export function deriveDashboardSnapshotScopes(
    context: Pick<
        CreditAsOfBackfillRunContext,
        "accountId" | "insurancePolicies"
    >,
    snapshotDate: Date
): CreditDashboardSnapshotScope[] {
    const scopes: CreditDashboardSnapshotScope[] = [
        {
            accountId: context.accountId,
            policyId: null,
            businessUnitId: null,
        },
    ];
    for (const policy of context.insurancePolicies) {
        if (!isPolicyEffectivelyActiveOnDate(policy, snapshotDate)) {
            continue;
        }
        scopes.push({
            accountId: context.accountId,
            policyId: policy.id,
            businessUnitId: null,
        });
    }
    return scopes;
}

/** Lightweight context for injected loaders/writers (tests); only MEP date is resolved. */
export function createMinimalCreditAsOfBackfillRunContext(
    accountId: number,
    mepBreachStartDate: Date | null
): CreditAsOfBackfillRunContext {
    return {
        accountId,
        accountCurrency: null,
        invoicePaidTolerance: null,
        hasTopUpPolicies: false,
        mepBreachStartDate,
        activeCustomerPolicies: [],
        insurancePolicies: [],
        businessUnitIds: [],
        capacityGapEnsured: false,
    };
}

export async function buildCreditAsOfBackfillRunContext(
    accountId: number,
    options?: {
        dbClient?: DbClient;
        customerIds?: number[];
        policyId?: number;
        mepBreachStartDate?: Date | null;
        invoicePaidTolerance?: number;
        replayFromDate?: Date;
        replayToDate?: Date;
    }
): Promise<CreditAsOfBackfillRunContext> {
    const db = options?.dbClient ?? defaultPrisma;
    const [
        account,
        activeCustomerPolicies,
        insurancePolicies,
        businessUnitIds,
        accountHasTopUp,
        mepBreachStartDate,
        invoicePaidTolerance,
    ] = await Promise.all([
        db.account.findUnique({
            where: { id: accountId },
            select: {
                currency: true,
                customer_limit_expiration_warning_days: true,
                reporting_date_warning_days: true,
                credit_limit_warning_threshold_pct: true,
                credit_score_validity_warning_days: true,
            },
        }),
        loadActiveCustomerPoliciesForTrendSync(accountId, {
            customerIds: options?.customerIds,
            policyId: options?.policyId,
            dbClient: db,
        }),
        loadInsurancePoliciesForAccount(accountId, db),
        loadActiveBusinessUnitIds(accountId, db),
        hasTopUpPolicies(accountId),
        options?.mepBreachStartDate !== undefined
            ? Promise.resolve(options.mepBreachStartDate)
            : resolveMepBreachStartDate(accountId, db),
        options?.invoicePaidTolerance !== undefined
            ? Promise.resolve(options.invoicePaidTolerance)
            : resolveInvoicePaidTolerance(accountId, db),
    ]);

    let topUpsByCustomerId: Map<number, TopUpRowForTrendReplay[]> | undefined;
    if (
        accountHasTopUp &&
        options?.replayFromDate != null &&
        options?.replayToDate != null
    ) {
        const customerIds = Array.from(
            new Set(activeCustomerPolicies.map((cp) => cp.customer_id))
        );
        topUpsByCustomerId = await loadTopUpsForReplayRange(
            accountId,
            customerIds,
            options.replayFromDate,
            options.replayToDate,
            db
        );
    }

    const dashboardAccountSettings =
        resolveCreditDashboardAccountSettings(account);

    return {
        accountId,
        accountCurrency: dashboardAccountSettings.accountCurrency,
        dashboardAccountSettings,
        invoicePaidTolerance,
        hasTopUpPolicies: accountHasTopUp,
        mepBreachStartDate,
        activeCustomerPolicies,
        insurancePolicies,
        businessUnitIds,
        capacityGapEnsured: false,
        topUpsByCustomerId,
    };
}

/**
 * Mark capacity-gap maintenance complete for historical replay runs.
 * Stored invoice/policy gap fields are not date-dependent for as-of backfill;
 * CPT and dashboard writers compute exposure from ledger + limits per day.
 */
export async function ensureCapacityGapsForBackfillRun(
    context: CreditAsOfBackfillRunContext,
    _options?: { dbClient?: DbClient }
): Promise<CreditAsOfBackfillRunContext> {
    if (context.capacityGapEnsured) {
        return context;
    }
    return { ...context, capacityGapEnsured: true };
}
