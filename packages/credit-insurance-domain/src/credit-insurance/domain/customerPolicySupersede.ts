import { toUtcDateOnly } from "./shared/insurancePolicyLifecycle";

/**
 * Fields to mark a live CustomerPolicy as superseded by a newer version.
 * `policy_change_end_date` is the first UTC day the old version is no longer
 * the live attachment (same meaning as dated unassign) — equal to the next
 * version's `policy_change_start_date`.
 */
export function customerPolicySupersedeUpdateData(args: {
    nextVersionStartDate: Date;
    modifiedBy?: string | null;
}): {
    is_active: false;
    status: "inactive";
    policy_change_end_date: Date;
    modified_by?: string;
} {
    const data = {
        is_active: false as const,
        status: "inactive" as const,
        policy_change_end_date: toUtcDateOnly(args.nextVersionStartDate),
    };
    if (args.modifiedBy != null && args.modifiedBy !== "") {
        return { ...data, modified_by: args.modifiedBy };
    }
    return data;
}
