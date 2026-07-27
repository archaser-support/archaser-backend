export declare const POLICY_EXCLUSION_REASONS: readonly ["Pending review", "Credit hold", "Insurer declined", "Other"];
export type PolicyExclusionReason = (typeof POLICY_EXCLUSION_REASONS)[number];
export declare function normalizePolicyExclusionReason(reason: unknown): string | null;
export declare function isAllowedPolicyExclusionReason(reason: unknown): boolean;
export declare function isCustomerPolicyExcluded(reason: unknown): boolean;
export declare function deriveExcludedFromPolicy(reason: unknown): boolean;
export declare function isPendingReviewExclusion(reason: unknown): boolean;
export declare function hasActiveLinkedPolicy(insurancePolicyId: number | null | undefined): boolean;
export type UncoveredExposureFields = {
    hasLinkedPolicy: boolean;
    exclusionReason: unknown;
};
export type NoPolicyExposureCardFields = UncoveredExposureFields & {
    openAr: number;
};
export declare function isUncoveredExposureCustomer(fields: UncoveredExposureFields): boolean;
export declare function isNoPolicyExposureCardCustomer(fields: NoPolicyExposureCardFields): boolean;
