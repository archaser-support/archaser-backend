import { startOfTodayUtc } from "./shared/insurancePolicyLifecycle";

/** Customer limit types that contribute to portfolio policy-limit usage bars. */
export type PolicyLimitUsageLimitType = "Named" | "DCL";

/**
 * Resolved customer row for portfolio policy-limit usage.
 * Monetary values must already be in the account display currency.
 */
export type PolicyLimitUsageRowInput = {
    limitType: PolicyLimitUsageLimitType | string | null;
    openArAccount: number;
    approvedLimitAccount: number;
    topUpTotalAccount: number;
    /** CustomerPolicy.is_active */
    isActive: boolean;
    /**
     * Customer.collection_status (Active or Inactive both eligible for portfolio bars).
     * Kept for callers/diagnostics; not used as an eligibility gate.
     */
    isCollectionActive: boolean;
    excludedFromPolicy: boolean;
    outdatedDcl: boolean;
    approvedLimitExpirationDate: Date | null;
};

export type PolicyLimitUsageCategoryTotals = {
    /** Sum of eligible open AR in account currency. */
    openAr: number;
    /** Sum of eligible base approved limits in account currency. */
    approvedLimit: number;
    /** Sum of eligible active top-up cover in account currency. */
    topUpTotal: number;
    /** Sum of per-customer used within limit: Σ min(AR, approved limit). */
    usedWithinLimit: number;
    /** Sum of per-customer remaining: Σ max(0, approved limit − AR). */
    remaining: number;
    /**
     * Sum of per-customer AR above base covered by that customer's top-up
     * (not min(portfolio excess, Σ top-up)).
     */
    topUpCoveredExcess: number;
    /** Sum of per-customer AR beyond base approved limit plus that customer's top-up. */
    uncoveredExposure: number;
    /**
     * Portfolio usage percentage: usedWithinLimit / approved capacity × 100.
     * Combined uses base + top-up; Named and DCL use base approved only.
     */
    usagePct: number;
};

export type PortfolioPolicyLimitUsage = {
    combined: PolicyLimitUsageCategoryTotals;
    named: PolicyLimitUsageCategoryTotals;
    dclSdl: PolicyLimitUsageCategoryTotals;
};

export type CustomerPolicyLimitUsageSegments = {
    openAr: number;
    approvedLimit: number;
    topUpTotal: number;
    usedWithinLimit: number;
    remaining: number;
    topUpCoveredExcess: number;
    uncoveredExposure: number;
};

type CategoryAccumulators = {
    openAr: number;
    approvedLimit: number;
    topUpTotal: number;
    usedWithinLimit: number;
    remaining: number;
    topUpCoveredExcess: number;
    uncoveredExposure: number;
};

function emptyAccumulators(): CategoryAccumulators {
    return {
        openAr: 0,
        approvedLimit: 0,
        topUpTotal: 0,
        usedWithinLimit: 0,
        remaining: 0,
        topUpCoveredExcess: 0,
        uncoveredExposure: 0,
    };
}

/**
 * Per-customer bar segments: AR vs that customer's approved limit and top-up.
 */
export function computeCustomerPolicyLimitUsageSegments(args: {
    openArAccount: number;
    approvedLimitAccount: number;
    topUpTotalAccount: number;
}): CustomerPolicyLimitUsageSegments {
    const openAr = Math.max(0, Number(args.openArAccount) || 0);
    const approvedLimit = Math.max(0, Number(args.approvedLimitAccount) || 0);
    const topUpTotal = Math.max(0, Number(args.topUpTotalAccount) || 0);

    const usedWithinLimit = Math.min(openAr, approvedLimit);
    const remaining = Math.max(0, approvedLimit - openAr);
    const aboveBase = Math.max(0, openAr - approvedLimit);
    const topUpCoveredExcess = Math.min(aboveBase, topUpTotal);
    const uncoveredExposure = Math.max(0, aboveBase - topUpTotal);

    return {
        openAr,
        approvedLimit,
        topUpTotal,
        usedWithinLimit,
        remaining,
        topUpCoveredExcess,
        uncoveredExposure,
    };
}

/** Effective approved capacity: base approved limit plus active top-up cover. */
export function effectiveApprovedLimit(
    approvedLimit: number,
    topUpTotal: number
): number {
    return Math.max(0, approvedLimit) + Math.max(0, topUpTotal);
}

function finalizeCategoryTotals(
    acc: CategoryAccumulators,
    options: { includeTopUpInUsage: boolean }
): PolicyLimitUsageCategoryTotals {
    const limitForUsage = options.includeTopUpInUsage
        ? effectiveApprovedLimit(acc.approvedLimit, acc.topUpTotal)
        : Math.max(0, acc.approvedLimit);
    const usagePct =
        limitForUsage > 0
            ? (acc.usedWithinLimit / limitForUsage) * 100
            : 0;
    return {
        openAr: acc.openAr,
        approvedLimit: acc.approvedLimit,
        topUpTotal: acc.topUpTotal,
        usedWithinLimit: acc.usedWithinLimit,
        remaining: acc.remaining,
        topUpCoveredExcess: acc.topUpCoveredExcess,
        uncoveredExposure: acc.uncoveredExposure,
        usagePct,
    };
}

/** True when approved_limit_expiration_date is strictly before the as-of UTC day. */
export function isApprovedLimitExpired(
    approvedLimitExpirationDate: Date | null | undefined,
    asOfDate: Date = new Date()
): boolean {
    if (approvedLimitExpirationDate == null) {
        return false;
    }
    const asOf = startOfTodayUtc(asOfDate);
    const expiry = startOfTodayUtc(approvedLimitExpirationDate);
    return expiry < asOf;
}

/**
 * Approved eligible customers only: active policy row, non-excluded,
 * non-outdated, non-expired, positive approved limit, Named or DCL.
 * Collection Active and Inactive both count.
 */
export function isEligiblePolicyLimitUsageRow(
    row: PolicyLimitUsageRowInput,
    asOfDate: Date = new Date()
): boolean {
    if (!row.isActive) {
        return false;
    }
    if (row.excludedFromPolicy) {
        return false;
    }
    if (row.outdatedDcl) {
        return false;
    }
    if (
        !Number.isFinite(row.approvedLimitAccount) ||
        row.approvedLimitAccount <= 0
    ) {
        return false;
    }
    if (isApprovedLimitExpired(row.approvedLimitExpirationDate, asOfDate)) {
        return false;
    }
    const limitType = row.limitType;
    return limitType === "Named" || limitType === "DCL";
}

function addCustomerSegmentsToCategory(
    category: CategoryAccumulators,
    segments: CustomerPolicyLimitUsageSegments
): void {
    category.openAr += segments.openAr;
    category.approvedLimit += segments.approvedLimit;
    category.topUpTotal += segments.topUpTotal;
    category.usedWithinLimit += segments.usedWithinLimit;
    category.remaining += segments.remaining;
    category.topUpCoveredExcess += segments.topUpCoveredExcess;
    category.uncoveredExposure += segments.uncoveredExposure;
}

/**
 * Aggregate approved eligible customer rows into combined, Named, and DCL/SDL
 * category totals. Bar segments (including top-up cover) are summed per customer;
 * they are not derived from portfolio (Σ AR − Σ limit) vs Σ top-up.
 */
export function aggregatePortfolioPolicyLimitUsage(
    rows: PolicyLimitUsageRowInput[],
    asOfDate: Date = new Date()
): PortfolioPolicyLimitUsage {
    const combined = emptyAccumulators();
    const named = emptyAccumulators();
    const dclSdl = emptyAccumulators();

    for (const row of rows) {
        if (!isEligiblePolicyLimitUsageRow(row, asOfDate)) {
            continue;
        }
        const segments = computeCustomerPolicyLimitUsageSegments({
            openArAccount: row.openArAccount,
            approvedLimitAccount: row.approvedLimitAccount,
            topUpTotalAccount: row.topUpTotalAccount,
        });
        addCustomerSegmentsToCategory(combined, segments);
        if (row.limitType === "Named") {
            addCustomerSegmentsToCategory(named, segments);
        } else if (row.limitType === "DCL") {
            addCustomerSegmentsToCategory(dclSdl, segments);
        }
    }

    return {
        combined: finalizeCategoryTotals(combined, {
            includeTopUpInUsage: true,
        }),
        named: finalizeCategoryTotals(named, { includeTopUpInUsage: false }),
        dclSdl: finalizeCategoryTotals(dclSdl, { includeTopUpInUsage: false }),
    };
}
