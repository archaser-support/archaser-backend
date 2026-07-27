"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEligibleTopUpParentPolicy = isEligibleTopUpParentPolicy;
exports.filterTopUpParentPolicyOptions = filterTopUpParentPolicyOptions;
const insurancePolicyLifecycle_1 = require("./insurancePolicyLifecycle");
function isEligibleTopUpParentPolicy(policy, todayUtc) {
    if (policy.policy_kind !== "Primary") {
        return false;
    }
    if (policy.start_date != null && policy.end_date != null) {
        return (0, insurancePolicyLifecycle_1.isPrimaryPolicyAssignable)({
            status: policy.status,
            startDate: policy.start_date,
            endDate: policy.end_date,
            todayUtc,
        });
    }
    return policy.status === "Active";
}
function filterTopUpParentPolicyOptions(policies, options) {
    return policies.filter((p) => isEligibleTopUpParentPolicy(p, options?.todayUtc) &&
        (options?.excludePolicyId == null || p.id !== options.excludePolicyId));
}
//# sourceMappingURL=topUpParentPolicy.js.map