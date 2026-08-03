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
/**
 * Per-customer bar segments: AR vs that customer's approved limit and top-up.
 */
export declare function computeCustomerPolicyLimitUsageSegments(args: {
    openArAccount: number;
    approvedLimitAccount: number;
    topUpTotalAccount: number;
}): CustomerPolicyLimitUsageSegments;
/** Effective approved capacity: base approved limit plus active top-up cover. */
export declare function effectiveApprovedLimit(approvedLimit: number, topUpTotal: number): number;
/** True when approved_limit_expiration_date is strictly before the as-of UTC day. */
export declare function isApprovedLimitExpired(approvedLimitExpirationDate: Date | null | undefined, asOfDate?: Date): boolean;
/**
 * Approved eligible customers only: active policy row, non-excluded,
 * non-outdated, non-expired, positive approved limit, Named or DCL.
 * Collection Active and Inactive both count.
 */
export declare function isEligiblePolicyLimitUsageRow(row: PolicyLimitUsageRowInput, asOfDate?: Date): boolean;
/**
 * Aggregate approved eligible customer rows into combined, Named, and DCL/SDL
 * category totals. Bar segments (including top-up cover) are summed per customer;
 * they are not derived from portfolio (Σ AR − Σ limit) vs Σ top-up.
 */
export declare function aggregatePortfolioPolicyLimitUsage(rows: PolicyLimitUsageRowInput[], asOfDate?: Date): PortfolioPolicyLimitUsage;
