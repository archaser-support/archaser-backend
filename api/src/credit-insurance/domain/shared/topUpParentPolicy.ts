import { isPrimaryPolicyAssignable } from "./insurancePolicyLifecycle";

/** Parent of a TopUp policy must be assignable Primary (Active and in term). */
export function isEligibleTopUpParentPolicy(
    policy: {
        policy_kind?: string | null;
        status?: string | null;
        start_date?: Date | string | null;
        end_date?: Date | string | null;
    },
    todayUtc?: Date
): boolean {
    if (policy.policy_kind !== "Primary") {
        return false;
    }
    if (policy.start_date != null && policy.end_date != null) {
        return isPrimaryPolicyAssignable({
            status: policy.status,
            startDate: policy.start_date,
            endDate: policy.end_date,
            todayUtc,
        });
    }
    return policy.status === "Active";
}

export function filterTopUpParentPolicyOptions<
    T extends {
        id: number;
        policy_kind?: string | null;
        status?: string | null;
        start_date?: Date | string | null;
        end_date?: Date | string | null;
    },
>(policies: T[], options?: { excludePolicyId?: number; todayUtc?: Date }): T[] {
    return policies.filter(
        (p) =>
            isEligibleTopUpParentPolicy(p, options?.todayUtc) &&
            (options?.excludePolicyId == null || p.id !== options.excludePolicyId)
    );
}
