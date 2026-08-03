"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POLICY_EXCLUSION_REASONS = void 0;
exports.normalizePolicyExclusionReason = normalizePolicyExclusionReason;
exports.isAllowedPolicyExclusionReason = isAllowedPolicyExclusionReason;
exports.isCustomerPolicyExcluded = isCustomerPolicyExcluded;
exports.deriveExcludedFromPolicy = deriveExcludedFromPolicy;
exports.isPendingReviewExclusion = isPendingReviewExclusion;
exports.hasActiveLinkedPolicy = hasActiveLinkedPolicy;
exports.isUncoveredExposureCustomer = isUncoveredExposureCustomer;
exports.isNoPolicyExposureCardCustomer = isNoPolicyExposureCardCustomer;
exports.POLICY_EXCLUSION_REASONS = [
    "Pending review",
    "Credit hold",
    "Insurer declined",
    "Other",
];
function normalizePolicyExclusionReason(reason) {
    if (reason == null) {
        return null;
    }
    const normalized = String(reason).trim();
    return normalized.length > 0 ? normalized : null;
}
function normalizedLower(value) {
    return value.trim().toLowerCase();
}
function isAllowedPolicyExclusionReason(reason) {
    const normalized = normalizePolicyExclusionReason(reason);
    if (!normalized) {
        return false;
    }
    return exports.POLICY_EXCLUSION_REASONS.some((allowed) => normalizedLower(allowed) === normalizedLower(normalized));
}
function isCustomerPolicyExcluded(reason) {
    return normalizePolicyExclusionReason(reason) != null;
}
function deriveExcludedFromPolicy(reason) {
    return isCustomerPolicyExcluded(reason);
}
function isPendingReviewExclusion(reason) {
    const normalized = normalizePolicyExclusionReason(reason);
    if (!normalized) {
        return false;
    }
    return normalizedLower(normalized) === normalizedLower("Pending review");
}
function hasActiveLinkedPolicy(insurancePolicyId) {
    return insurancePolicyId != null;
}
/** No linked policy or any non-empty exclusion reason. */
function isUncoveredExposureCustomer(fields) {
    return (!fields.hasLinkedPolicy ||
        isCustomerPolicyExcluded(fields.exclusionReason));
}
/** Card cohort: open AR > 0 and (no linked policy or pending-review exclusion only). */
function isNoPolicyExposureCardCustomer(fields) {
    if (fields.openAr <= 0) {
        return false;
    }
    return (!fields.hasLinkedPolicy ||
        isPendingReviewExclusion(fields.exclusionReason));
}
