export type PolicyLimitUsageLimitType = "Named" | "DCL";
export type PolicyLimitUsageRowInput = {
    limitType: PolicyLimitUsageLimitType | string | null;
    openArAccount: number;
    approvedLimitAccount: number;
    topUpTotalAccount: number;
    isActive: boolean;
    isCollectionActive: boolean;
    excludedFromPolicy: boolean;
    outdatedDcl: boolean;
    approvedLimitExpirationDate: Date | null;
};
export type PolicyLimitUsageCategoryTotals = {
    openAr: number;
    approvedLimit: number;
    topUpTotal: number;
    usedWithinLimit: number;
    remaining: number;
    topUpCoveredExcess: number;
    uncoveredExposure: number;
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
export declare function computeCustomerPolicyLimitUsageSegments(args: {
    openArAccount: number;
    approvedLimitAccount: number;
    topUpTotalAccount: number;
}): CustomerPolicyLimitUsageSegments;
export declare function effectiveApprovedLimit(approvedLimit: number, topUpTotal: number): number;
export declare function isApprovedLimitExpired(approvedLimitExpirationDate: Date | null | undefined, asOfDate?: Date): boolean;
export declare function isEligiblePolicyLimitUsageRow(row: PolicyLimitUsageRowInput, asOfDate?: Date): boolean;
export declare function aggregatePortfolioPolicyLimitUsage(rows: PolicyLimitUsageRowInput[], asOfDate?: Date): PortfolioPolicyLimitUsage;
