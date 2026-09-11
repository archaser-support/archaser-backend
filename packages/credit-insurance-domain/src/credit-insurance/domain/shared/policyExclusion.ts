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

/**
 * Uncovered inputs from a scoped CustomerPolicy link (dashboard enrich / KPI row).
 * Prefer this over “any active linked policy” so portfolio and customer cards match.
 */
export function uncoveredExposureFieldsFromPolicyLink(args: {
    insurancePolicyId: number | null | undefined;
    exclusionReason: unknown;
}): UncoveredExposureFields {
    return {
        hasLinkedPolicy: hasActiveLinkedPolicy(args.insurancePolicyId),
        exclusionReason: args.exclusionReason,
    };
}

/** No linked policy or any non-empty exclusion reason. */
export function isUncoveredExposureCustomer(
    fields: UncoveredExposureFields
): boolean {
    return (
        !fields.hasLinkedPolicy ||
        isCustomerPolicyExcluded(fields.exclusionReason)
    );
}

/**
 * Full-open-AR at-risk / No Policy card membership (without the AR>0 gate):
 * no linked policy, or pending-review exclusion only.
 * Other exclusions (Credit hold, Insurer declined, Other) stay on the insured
 * per-invoice max path so At Risk can reconcile with Cap Gap + Terms Breach.
 */
export function isFullOpenArAtRiskCustomer(
    fields: UncoveredExposureFields
): boolean {
    return (
        !fields.hasLinkedPolicy ||
        isPendingReviewExclusion(fields.exclusionReason)
    );
}

/** Card cohort: open AR > 0 and (no linked policy or pending-review exclusion only). */
export function isNoPolicyExposureCardCustomer(
    fields: NoPolicyExposureCardFields
): boolean {
    if (fields.openAr <= 0) {
        return false;
    }
    return isFullOpenArAtRiskCustomer(fields);
}
