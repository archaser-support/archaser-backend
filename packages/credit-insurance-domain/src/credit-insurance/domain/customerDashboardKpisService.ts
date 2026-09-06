import { Prisma } from "@prisma/client";

import { prisma } from "../domain-db";
import { startOfTodayUtc } from "./shared/insurancePolicyLifecycle";

import {
    type TermsBreachCountByReason,
    fetchOpenReceivableForCustomer,
    fetchOpenReceivableForCustomerByCurrency,
    getCustomerTermsBreachOutstandingForAtRisk,
    getCustomerTermsBreachOutstandingSum,
    getCustomerTermsBreachOutstandingByCurrencyForAtRisk,
    getCustomerTermsBreachOutstandingSumByCurrency,
    resolveOpenArOnPolicyInLimitCurrency,
} from "./creditInsuranceDashboardService";
import {
    resolveCustomerCreditInsuranceSecondaryCurrency,
    resolveCustomerTotalArSecondaryFromInvoiceBuckets,
    deriveSecondaryAmountFromInvoiceBucketRatio,
    resolveInvoiceBucketRatioArPair,
    convertAmountToCurrencyLatestRate,
} from "./customerCreditInsuranceHeaderAmounts";
import {
    getCustomerRiskExposureAmountTrendByPolicy,
    type RiskExposurePolicySeries,
} from "./customerPolicyTrendService";
import { computeTopUpUsageMetrics } from "./invoiceCapacityGapAmounts";
import {
    computeCustomerRiskExposure,
    computeCustomerTotalAr,
} from "./invoiceInsuranceFields";
import { fetchOpenReceivableByCustomerMapInAccountCurrency } from "./openReceivableByCustomerCurrency";
import {
    storedCapacityGapAmount,
    resolveStoredCapacityGapSecondary,
} from "./policyGapAmounts";
import { resolveEffectiveApprovedLimit } from "./resolveEffectiveApprovedLimit";
import { ensureCustomerCapacityGapStored } from "./syncCreditInsuranceGapPipeline";
import {
    resolveUncoveredExposureFromPolicyRows,
} from "./termBreachResolver";

export type CustomerDashboardKpiCards = {
    healthIndex: number;
    atRiskExposure: number;
    policyUsagePct: number | null;
    activePolicyCount: number;
    termsBreachOutstanding: number;
    /** Distinct open Due/Overdue invoices with any terms-breach flag (same membership as outstanding). */
    termsBreachInvoiceCount: number;
    capacityGapAmount: number;
    /** Uninsured exposure: full open AR when excluded from policy, else stored uninsured (0 when outdated DCL). */
    uninsuredAmount: number;
    /** True when the scoped customer policy is excluded from policy. */
    isExcludedFromPolicy: boolean;
    totalAr: number;
    accountCurrency: string | null;
    creditInsuranceSecondaryCurrency?: string | null;
    totalArSecondary?: number | null;
    capacityGapAmountSecondary?: number | null;
    /** Limit/invoice currency for gap secondary line (may differ from creditInsuranceSecondaryCurrency). */
    capacityGapLimitCurrency?: string | null;
    uninsuredAmountSecondary?: number | null;
    termsBreachOutstandingSecondary?: number | null;
    atRiskExposureSecondary?: number | null;
    topUpTotal?: number | null;
    topUpUsagePct?: number | null;
    effectiveLimit?: number | null;
    effectiveUsagePct?: number | null;
};

export type { RiskExposurePolicySeries } from "./customerPolicyTrendService";

export type CustomerDashboardKpisResponse = {
    customerId: number;
    policyId: number | null;
    cards: CustomerDashboardKpiCards;
    riskExposureByPolicy: RiskExposurePolicySeries[];
    termsBreachReasonDistribution: TermsBreachCountByReason & { other: number };
};

/**
 * Customer dashboard KPI formulas (v1) — aligned with credit dashboard / customer GET.
 *
 * - **Health index:** `(compliantExposure / totalAr) × 100`, clamped 0–100; 100 when totalAr ≤ 0.
 *   compliantExposure = totalAr − atRiskExposure (at-risk capped at totalAr).
 * - **At risk exposure:** No policy → totalAr; with policy → `min(totalAr, max(limit driver, terms breach))`.
 *   When the account has top-up policies, limit driver = AR above **effective** limit (approved + top-up);
 *   otherwise stored capacity gap (invoice-summed).
 * - **Capacity gap:** Per insurance policy, sum of open invoice `capacity_gap_amount` synced to
 *   `CustomerPolicy.capacity_gap_amount`. Sticky per-invoice gaps are authoritative — no policy-level
 *   or AR cap on the customer KPI.
 * - **Terms breach:** Sum of outstanding on Due/Overdue breach invoices (same flags as terms report).
 * - **Policy usage %:** `min(999.99, (100 × Σ policy AR) / Σ approved limits)` for active policies in scope.
 * - **Active policies:** Count of active `CustomerPolicy` rows in scope.
 * - Monetary amounts: invoice/policy aggregates in **account base currency** (`Account.currency`).
 */

/**
 * Same formula as portfolio credit dashboard health index, scoped to one customer.
 * healthIndex = (compliantExposure / totalReceivables) × 100
 */
export function computeCustomerHealthIndex(
    totalAr: number,
    atRiskExposure: number
): number {
    const ar = Math.max(0, totalAr);
    if (ar <= 0) {
        return 100;
    }
    const atRisk = Math.max(0, Math.min(ar, atRiskExposure));
    const compliantExposure = Math.max(0, ar - atRisk);
    return Math.max(
        0,
        Math.min(100, (100 * compliantExposure) / ar)
    );
}

export type CustomerTermsBreachCountByReasonResult = {
    distribution: TermsBreachCountByReason & { other: number };
    /** Distinct invoices matching the terms-breach outstanding membership. */
    invoiceCount: number;
};

export async function getCustomerTermsBreachCountByReason(
    accountId: number,
    customerId: number,
    policyId?: number
): Promise<CustomerTermsBreachCountByReasonResult> {
    type AggRow = {
        c: number;
        cnt_reporting: number;
        cnt_payment_term: number;
        cnt_overdue_mep: number;
        cnt_outdated_dcl: number;
        cnt_after_policy_end: number;
    };

    const rows = await prisma.$queryRaw<AggRow[]>`
        SELECT COUNT(*)::int AS c,
          COUNT(*) FILTER (WHERE i.reporting_breach = true)::int AS cnt_reporting,
          COUNT(*) FILTER (WHERE i.ctv_payment_term = true)::int AS cnt_payment_term,
          COUNT(*) FILTER (WHERE i.ctv_customer_overdue_mep = true)::int AS cnt_overdue_mep,
          COUNT(*) FILTER (WHERE i.ctv_outdated_dcl = true)::int AS cnt_outdated_dcl,
          COUNT(*) FILTER (WHERE i.ctv_invoice_after_policy_end = true)::int AS cnt_after_policy_end
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND i.status IN ('Due', 'Overdue')
          AND i.amount >= 0
          AND (
            ${policyId ?? null}::int IS NULL
            OR i.policy_id = ${policyId ?? null}
          )
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
    `;

    const row = rows[0];
    const invoiceCount = Math.max(0, Number(row?.c ?? 0));
    const base: TermsBreachCountByReason = {
        reportingBreach: Number(row?.cnt_reporting ?? 0),
        paymentTerm: Number(row?.cnt_payment_term ?? 0),
        customerOverdueMep: Number(row?.cnt_overdue_mep ?? 0),
        outdatedDcl: Number(row?.cnt_outdated_dcl ?? 0),
        invoiceAfterPolicyEnd: Number(row?.cnt_after_policy_end ?? 0),
    };
    return {
        distribution: applyTermsBreachOtherBucket(base, invoiceCount),
        invoiceCount,
    };
}

type CustomerPolicyGapRow = {
    insurance_policy_id: number | null;
    is_active: boolean;
    outdated_dcl: boolean | null;
    excluded_from_policy?: boolean | null;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency?: string | null;
    capacity_gap_amount: number | null;
    capacity_gap_amount1: number | null;
    capacity_gap_currency1: string | null;
    capacity_gap_amount2: number | null;
    capacity_gap_currency2: string | null;
};

type CustomerPolicyPickRow = Pick<
    CustomerPolicyGapRow,
    "insurance_policy_id" | "is_active"
>;

/** One CustomerPolicy row per insurance policy (active row wins). */
function pickPolicyRowPerInsurancePolicy<T extends CustomerPolicyPickRow>(
    rows: T[]
): T[] {
    const byPolicyId = new Map<number, T>();
    for (const row of rows) {
        const pid = row.insurance_policy_id;
        if (pid == null) {
            continue;
        }
        const existing = byPolicyId.get(pid);
        if (!existing || (row.is_active && !existing.is_active)) {
            byPolicyId.set(pid, row);
        }
    }
    return Array.from(byPolicyId.values());
}

function scopeCustomerPolicyGapRows<T extends CustomerPolicyGapRow>(
    rows: T[],
    policyId?: number
): T[] {
    if (policyId != null) {
        return rows.length > 0 ? [rows[0]!] : [];
    }
    return pickPolicyRowPerInsurancePolicy(rows);
}

function resolveCustomerCapacityGapFromPolicyRows(
    policyRows: CustomerPolicyGapRow[],
    policyId: number | undefined
): number {
    const scopedRows = scopeCustomerPolicyGapRows(policyRows, policyId);
    let totalGap = 0;
    for (const row of scopedRows) {
        totalGap += storedCapacityGapAmount(row);
    }
    return Math.max(0, totalGap);
}

/** Maps raw breach flag counts to distribution; `other` = invoices not covered by known flags. */
export function applyTermsBreachOtherBucket(
    row: TermsBreachCountByReason & { other?: number },
    totalInvoices: number
): TermsBreachCountByReason & { other: number } {
    const knownSum =
        row.reportingBreach +
        row.paymentTerm +
        row.customerOverdueMep +
        row.outdatedDcl +
        row.invoiceAfterPolicyEnd;
    return {
        ...row,
        other: Math.max(0, totalInvoices - knownSum),
    };
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
    if (value == null) {
        return null;
    }
    return new Prisma.Decimal(value).toNumber();
}

export type PortfolioUsageOptions = {
    /** All-policies view: count policies with open AR even when the row is inactive. */
    includeInactiveWithExposure?: boolean;
};

export async function computePortfolioUsagePct(
    policies: Array<{
        insurance_policy_id: number | null;
        approved_limit: Prisma.Decimal | null;
        is_active: boolean;
        approved_limit_currency?: string | null;
    }>,
    openArByPolicy: Map<number, number>,
    accountCurrency: string | null,
    options?: PortfolioUsageOptions
): Promise<number | null> {
    let totalLimit = 0;
    let totalUsed = 0;
    for (const p of policies) {
        if (p.insurance_policy_id == null) {
            continue;
        }
        const ar = Math.max(0, openArByPolicy.get(p.insurance_policy_id) ?? 0);
        const includePolicy = options?.includeInactiveWithExposure
            ? ar > 0
            : p.is_active;
        if (!includePolicy) {
            continue;
        }
        const limit = decimalToNumber(p.approved_limit);
        if (limit == null || limit <= 0) {
            continue;
        }
        const policyCurrency = p.approved_limit_currency?.trim().toUpperCase() || accountCurrency || "USD";
        const convertedLimit = await convertAmountToCurrencyLatestRate(
            policyCurrency,
            accountCurrency || "USD",
            limit
        );
        totalLimit += convertedLimit ?? limit;
        totalUsed += ar;
    }
    if (totalLimit <= 0) {
        return null;
    }
    return Math.min(999.99, (100 * totalUsed) / totalLimit);
}

export type PolicyUsageRowInput = {
    ar: number;
    approvedLimit: number;
    topUpTotal: number;
};

/**
 * Policy / top-up / effective usage % for dashboard cards (sheet 2 formulas).
 * AR and limits must share the same currency (policy limit currency).
 */
export function aggregatePolicyUsageFromRows(rows: PolicyUsageRowInput[]): {
    policyUsagePct: number | null;
    topUpTotal: number | null;
    topUpUsagePct: number | null;
    effectiveLimit: number | null;
    effectiveUsagePct: number | null;
} {
    let weightLimit = 0;
    let accPolicyUsage = 0;
    let weightTopUp = 0;
    let accTopUpUsage = 0;
    let weightEffective = 0;
    let accEffectiveUsage = 0;
    let totalTopUp = 0;
    let totalEffectiveLimit = 0;

    for (const row of rows) {
        const limit = Math.max(0, row.approvedLimit);
        if (limit <= 0) {
            continue;
        }
        const ar = Math.max(0, row.ar);
        const topUp = Math.max(0, row.topUpTotal);
        const usage = computeTopUpUsageMetrics({
            ar,
            approvedLimit: limit,
            topUpTotal: topUp,
        });

        weightLimit += limit;
        accPolicyUsage += usage.policyUsage * limit;

        if (topUp > 0) {
            weightTopUp += topUp;
            accTopUpUsage += usage.topUpUsage * topUp;
            totalTopUp += topUp;
            const effective = limit + topUp;
            weightEffective += effective;
            accEffectiveUsage += usage.effectiveUsage * effective;
            totalEffectiveLimit += effective;
        }
    }

    if (weightLimit <= 0) {
        return {
            policyUsagePct: null,
            topUpTotal: null,
            topUpUsagePct: null,
            effectiveLimit: null,
            effectiveUsagePct: null,
        };
    }

    return {
        policyUsagePct: Math.min(
            999.99,
            weightTopUp > 0 ? Math.min(100, (100 * accPolicyUsage) / weightLimit) : (100 * accPolicyUsage) / weightLimit
        ),
        topUpTotal: totalTopUp > 0 ? totalTopUp : null,
        topUpUsagePct:
            weightTopUp > 0
                ? Math.min(999.99, (100 * accTopUpUsage) / weightTopUp)
                : null,
        effectiveLimit: totalEffectiveLimit > 0 ? totalEffectiveLimit : null,
        effectiveUsagePct:
            weightEffective > 0
                ? Math.min(999.99, (100 * accEffectiveUsage) / weightEffective)
                : null,
    };
}

export async function getCustomerDashboardKpis(
    accountId: number,
    customerId: number,
    options?: { policyId?: number; days?: number }
): Promise<CustomerDashboardKpisResponse> {
    const policyId = options?.policyId;

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { currency: true, has_credit_insurance: true },
    });
    const accountCurrency = account?.currency?.trim() || null;

    if (account?.has_credit_insurance === true) {
        await ensureCustomerCapacityGapStored(customerId);
    }

    const policyRows = await prisma.customerPolicy.findMany({
        where: {
            customer_id: customerId,
            Customer: { account_id: accountId },
            ...(policyId != null ? { insurance_policy_id: policyId } : {}),
        },
        select: {
            id: true,
            insurance_policy_id: true,
            is_active: true,
            approved_limit: true,
            approved_limit_currency: true,
            outdated_dcl: true,
            excluded_from_policy: true,
            policy_exclusion_reason: true,
            capacity_gap_amount: true,
            capacity_gap_amount1: true,
            capacity_gap_currency1: true,
            capacity_gap_amount2: true,
            capacity_gap_currency2: true,
            uninsured_amount: true,
            uninsured_amount1: true,
            uninsured_currency1: true,
            uninsured_amount2: true,
            uninsured_currency2: true,
            InsurancePolicy: { select: { policy_number: true } },
        },
        orderBy: [{ is_active: "desc" }, { modified_at: "desc" }, { id: "desc" }],
    });

    const activePolicyCount = policyRows.filter((p) => p.is_active).length;

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, account_id: accountId },
        select: {
            total_due_amount: true,
            total_overdue_amount: true,
            customer_overdue_currency1: true,
            customer_overdue_currency2: true,
            customer_due_currency1: true,
            customer_due_currency2: true,
            customer_overdue_amount1: true,
            customer_overdue_amount2: true,
            customer_due_amount1: true,
            customer_due_amount2: true,
        },
    });

    // Open AR must be FX-converted to the account currency so the KPI cards
    // (at-risk, uninsured, health index) match the header "Total AR" card,
    // which uses fetchOpenReceivableByCustomerMapInAccountCurrency. The raw
    // fetchOpenReceivableForCustomer sums the outstanding_debt column without
    // FX conversion, so it diverges for foreign-currency invoices.
    const resolveCustomerOpenArInAccountCurrency = async (
        pid?: number
    ): Promise<number> => {
        if (accountCurrency) {
            const liveMap = await fetchOpenReceivableByCustomerMapInAccountCurrency(
                accountId,
                accountCurrency,
                {
                    customerIds: [customerId],
                    ...(pid != null ? { policyId: pid } : {}),
                }
            );
            return liveMap.get(customerId) ?? 0;
        }
        return fetchOpenReceivableForCustomer(
            accountId,
            customerId,
            pid ?? null
        );
    };

    let totalAr = 0;
    const openArByPolicy = new Map<number, number>();
    if (policyId != null) {
        totalAr = await resolveCustomerOpenArInAccountCurrency(policyId);
        openArByPolicy.set(policyId, totalAr);
    } else {
        const seenPolicyIds = new Set<number>();
        for (const row of policyRows) {
            const pid = row.insurance_policy_id;
            if (pid == null || seenPolicyIds.has(pid)) {
                continue;
            }
            seenPolicyIds.add(pid);
            const ar = await resolveCustomerOpenArInAccountCurrency(pid);
            openArByPolicy.set(pid, ar);
        }
        // Customer-level open AR (not summed per CustomerPolicy history row).
        totalAr = await resolveCustomerOpenArInAccountCurrency();
        if (totalAr <= 0) {
            totalAr = Math.max(
                Number(customer?.total_due_amount ?? 0),
                Number(customer?.total_overdue_amount ?? 0)
            );
        }
    }

    const capacityGapAmount = resolveCustomerCapacityGapFromPolicyRows(
        policyRows,
        policyId
    );

    const uncovered = resolveUncoveredExposureFromPolicyRows(
        policyRows,
        policyId
    );

    const flagBasedTermsBreach = await getCustomerTermsBreachOutstandingSum(
        accountId,
        customerId,
        policyId != null ? { policyId } : undefined
    );
    const flagBasedTermsBreachForAtRisk =
        await getCustomerTermsBreachOutstandingForAtRisk(
            accountId,
            customerId,
            policyId != null ? { policyId } : undefined
        );

    const termsBreachOutstanding = uncovered
        ? totalAr
        : flagBasedTermsBreach;
    const termsBreachForAtRisk = uncovered
        ? totalAr
        : flagBasedTermsBreachForAtRisk;

    const scopedPolicyRow =
        policyId != null
            ? policyRows.find((row) => row.insurance_policy_id === policyId) ??
              policyRows[0]
            : policyRows.find((row) => row.is_active) ?? policyRows[0];
    const isExcludedFromPolicy = scopedPolicyRow?.excluded_from_policy === true;

    const atRiskExposure = uncovered
        ? totalAr
        : computeCustomerRiskExposure({
                totalAr,
                capacityGapAmount,
                termsBreachOutstanding: termsBreachForAtRisk,
            });

    const uninsuredAmount = uncovered
        ? totalAr
        : scopedPolicyRow == null ||
          scopedPolicyRow.outdated_dcl === true ||
          scopedPolicyRow.approved_limit == null ||
          scopedPolicyRow.uninsured_amount == null
            ? 0
            : Math.max(0, Number(scopedPolicyRow.uninsured_amount));

    const healthIndex = computeCustomerHealthIndex(totalAr, atRiskExposure);

    const usagePolicyRows =
        policyId != null
            ? policyRows.slice(0, 1)
            : pickPolicyRowPerInsurancePolicy(policyRows);

    const today = startOfTodayUtc();
    const usageRowInputs: PolicyUsageRowInput[] = [];
    for (const row of usagePolicyRows) {
        if (row.outdated_dcl === true || row.excluded_from_policy === true) {
            continue;
        }
        const baseLimit = decimalToNumber(row.approved_limit);
        const pid = row.insurance_policy_id;
        if (baseLimit == null || baseLimit <= 0 || pid == null) {
            continue;
        }
        const includePolicy =
            policyId != null
                ? true
                : row.is_active ||
                (openArByPolicy.get(pid) ?? 0) > 0;
        if (!includePolicy) {
            continue;
        }

        const limitCurrency =
            row.approved_limit_currency?.trim().toUpperCase() ||
            accountCurrency ||
            "USD";

        const ar = await resolveOpenArOnPolicyInLimitCurrency(
            accountId,
            customerId,
            pid,
            limitCurrency,
            accountCurrency
        );

        const resolved = await resolveEffectiveApprovedLimit(customerId, {
            baseApprovedLimit: row.approved_limit,
            baseApprovedLimitCurrency: limitCurrency,
            outdatedDcl: row.outdated_dcl ?? false,
            excludedFromPolicy: row.excluded_from_policy ?? false,
            asOfDate: today,
            parentPrimaryPolicyId: pid,
        });

        usageRowInputs.push({
            ar,
            approvedLimit: baseLimit,
            topUpTotal: resolved.topUpTotalInLimitCurrency,
        });
    }

    const usageMetrics = aggregatePolicyUsageFromRows(usageRowInputs);
    const policyUsagePct = usageMetrics.policyUsagePct;
    const topUpTotal = usageMetrics.topUpTotal;
    const topUpUsagePct = usageMetrics.topUpUsagePct;
    const effectiveLimit = usageMetrics.effectiveLimit;
    const effectiveUsagePct = usageMetrics.effectiveUsagePct;

    const emptyTermsBreachCounts: CustomerTermsBreachCountByReasonResult = {
        distribution: {
            reportingBreach: 0,
            paymentTerm: 0,
            customerOverdueMep: 0,
            outdatedDcl: 0,
            invoiceAfterPolicyEnd: 0,
            other: 0,
        },
        invoiceCount: 0,
    };
    const [riskExposureByPolicy, termsBreachCounts] = await Promise.all([
        getCustomerRiskExposureAmountTrendByPolicy(accountId, customerId, {
            policyId,
            days: options?.days ?? 90,
            termsBreachOutstanding: termsBreachForAtRisk,
        }),
        uncovered
            ? Promise.resolve(emptyTermsBreachCounts)
            : getCustomerTermsBreachCountByReason(
                  accountId,
                  customerId,
                  policyId
              ),
    ]);
    const rawTermsBreachReasonDistribution = termsBreachCounts.distribution;
    const termsBreachInvoiceCount = termsBreachCounts.invoiceCount;
    const termsBreachReasonDistribution = isExcludedFromPolicy
        ? {
              ...rawTermsBreachReasonDistribution,
              // Customer-level policy exclusion is treated as a breach reason on dashboard.
              other: Math.max(0, rawTermsBreachReasonDistribution.other) + 1,
          }
        : rawTermsBreachReasonDistribution;

    const secondaryCurrency = customer
        ? resolveCustomerCreditInsuranceSecondaryCurrency(customer as any, accountCurrency)
        : null;

    let totalArSecondary: number | null = null;
    let capacityGapAmountSecondary: number | null = null;
    let capacityGapLimitCurrency: string | null = null;
    let uninsuredAmountSecondary: number | null = null;
    let termsBreachOutstandingSecondary: number | null = null;
    let atRiskExposureSecondary: number | null = null;

    if (secondaryCurrency && accountCurrency) {
        let openArSecondary = 0;
        if (policyId != null) {
            openArSecondary = await fetchOpenReceivableForCustomerByCurrency(
                accountId,
                customerId,
                secondaryCurrency,
                policyId
            );
            totalArSecondary =
                openArSecondary > 0
                    ? openArSecondary
                    : customer
                        ? resolveCustomerTotalArSecondaryFromInvoiceBuckets(
                            customer as any,
                            secondaryCurrency
                        )
                        : null;
        } else {
            // Dedupe by insurance_policy_id: copy-on-write versioning creates
            // multiple CustomerPolicy history rows sharing one insurance_policy_id,
            // so summing per-row double-counts the same invoices' AR (mirrors the
            // primary-currency open-AR loop above).
            const seenSecondaryPolicyIds = new Set<number>();
            for (const row of policyRows) {
                const pid = row.insurance_policy_id;
                if (pid == null || seenSecondaryPolicyIds.has(pid)) {
                    continue;
                }
                seenSecondaryPolicyIds.add(pid);
                const arSec = await fetchOpenReceivableForCustomerByCurrency(
                    accountId,
                    customerId,
                    secondaryCurrency,
                    pid
                );
                openArSecondary += arSec;
            }
            if (openArSecondary <= 0 && customer) {
                totalArSecondary = resolveCustomerTotalArSecondaryFromInvoiceBuckets(
                    customer as any,
                    secondaryCurrency
                );
                openArSecondary = totalArSecondary ?? 0;
            } else {
                totalArSecondary = openArSecondary;
            }
        }

        const denormalizedArPrimary = customer
            ? computeCustomerTotalAr(customer as any).toNumber()
            : 0;
        const { arPrimary: arPrimaryForRatio, arSecondary: arSecondaryForRatio } =
            customer
                ? resolveInvoiceBucketRatioArPair(
                    {
                        ...customer,
                        total_ar:
                            denormalizedArPrimary > 0
                                ? denormalizedArPrimary
                                : null,
                    },
                    secondaryCurrency,
                    totalAr
                )
                : { arPrimary: totalAr, arSecondary: null as number | null };

        if (totalArSecondary == null && arSecondaryForRatio != null) {
            totalArSecondary = arSecondaryForRatio;
        }

        // Prefer stored limit-currency gap when it matches the display secondary
        // currency; otherwise scale the account-currency primary by the same
        // invoice due/overdue bucket ratio as Total Due / Total AR. Do not FX-sum
        // per-invoice gaps here — those rollups do not match policy-level primary.
        capacityGapAmountSecondary =
            resolveStoredCapacityGapSecondary(policyRows, secondaryCurrency, {
                policyId: policyId ?? undefined,
            }) ??
            deriveSecondaryAmountFromInvoiceBucketRatio(
                capacityGapAmount,
                arPrimaryForRatio,
                arSecondaryForRatio
            );
        capacityGapLimitCurrency = secondaryCurrency;

        termsBreachOutstandingSecondary = uncovered
            ? openArSecondary
            : await getCustomerTermsBreachOutstandingSumByCurrency(
                  accountId,
                  customerId,
                  secondaryCurrency,
                  { policyId: policyId ?? undefined }
              );
        const termsBreachForAtRiskSecondary = uncovered
            ? openArSecondary
            : await getCustomerTermsBreachOutstandingByCurrencyForAtRisk(
                  accountId,
                  customerId,
                  secondaryCurrency,
                  { policyId: policyId ?? undefined }
              );

        const gapSecondaryForAtRisk = capacityGapAmountSecondary ?? 0;

        atRiskExposureSecondary = uncovered
            ? openArSecondary
            : computeCustomerRiskExposure({
                  totalAr: openArSecondary,
                  capacityGapAmount: gapSecondaryForAtRisk,
                  termsBreachOutstanding: termsBreachForAtRiskSecondary,
              });

        uninsuredAmountSecondary = uncovered ? openArSecondary : null;
    }

    return {
        customerId,
        policyId: policyId ?? null,
        cards: {
            healthIndex,
            atRiskExposure,
            policyUsagePct,
            activePolicyCount,
            termsBreachOutstanding,
            termsBreachInvoiceCount,
            capacityGapAmount,
            uninsuredAmount,
            isExcludedFromPolicy,
            totalAr,
            accountCurrency,
            creditInsuranceSecondaryCurrency: secondaryCurrency,
            totalArSecondary,
            capacityGapAmountSecondary,
            capacityGapLimitCurrency,
            uninsuredAmountSecondary,
            termsBreachOutstandingSecondary,
            atRiskExposureSecondary,
            topUpTotal,
            topUpUsagePct,
            effectiveLimit,
            effectiveUsagePct,
        },
        riskExposureByPolicy,
        termsBreachReasonDistribution,
    };
}
