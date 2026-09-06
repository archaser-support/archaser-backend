export const POLICY_EXCLUSION_REASONS = [
    "Pending review",
    "Credit hold",
    "Insurer declined",
    "Other",
] as const;
export type PolicyExclusionReason = (typeof POLICY_EXCLUSION_REASONS)[number];

export function normalizePolicyExclusionReason(
    reason: unknown
): string | null {
    if (reason == null) {
        return null;
    }
    const normalized = String(reason).trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizedLower(value: string): string {
    return value.trim().toLowerCase();
}

export function isAllowedPolicyExclusionReason(reason: unknown): boolean {
    const normalized = normalizePolicyExclusionReason(reason);
    if (!normalized) {
        return false;
    }
    return POLICY_EXCLUSION_REASONS.some(
        (allowed) => normalizedLower(allowed) === normalizedLower(normalized)
    );
}

export function isCustomerPolicyExcluded(reason: unknown): boolean {
    return normalizePolicyExclusionReason(reason) != null;
}

export function deriveExcludedFromPolicy(reason: unknown): boolean {
    return isCustomerPolicyExcluded(reason);
}

export function isPendingReviewExclusion(reason: unknown): boolean {
    const normalized = normalizePolicyExclusionReason(reason);
    if (!normalized) {
        return false;
    }
    return normalizedLower(normalized) === normalizedLower("Pending review");
}

export function hasActiveLinkedPolicy(
    insurancePolicyId: number | null | undefined
): boolean {
    return insurancePolicyId != null;
}

export type UncoveredExposureFields = {
    hasLinkedPolicy: boolean;
    exclusionReason: unknown;
};

export type NoPolicyExposureCardFields = UncoveredExposureFields & {
    openAr: number;
};

/** No linked policy or any non-empty exclusion reason. */
export function isUncoveredExposureCustomer(
    fields: UncoveredExposureFields
): boolean {
    return (
        !fields.hasLinkedPolicy ||
        isCustomerPolicyExcluded(fields.exclusionReason)
    );
}

/** Card cohort: open AR > 0 and (no linked policy or pending-review exclusion only). */
export function isNoPolicyExposureCardCustomer(
    fields: NoPolicyExposureCardFields
): boolean {
    if (fields.openAr <= 0) {
        return false;
    }
    return (
        !fields.hasLinkedPolicy ||
        isPendingReviewExclusion(fields.exclusionReason)
    );
}
