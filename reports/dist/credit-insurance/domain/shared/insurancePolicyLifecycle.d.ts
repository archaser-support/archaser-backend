export type InsurancePolicyLifecycleStatus = "Active" | "Inactive" | "Draft";
/** DB placeholder dates for TopUp policies (no policy-level term). */
export declare const TOPUP_POLICY_PLACEHOLDER_START: Date;
export declare const TOPUP_POLICY_PLACEHOLDER_END: Date;
export declare const TOPUP_PARENT_SYNC_ACTOR = "system:parent_policy_status_sync";
/** UTC calendar date at 00:00:00.000Z for the given instant (or today). */
export declare function startOfTodayUtc(from?: Date): Date;
/** Normalize API/DB dates to UTC midnight for DATE comparisons. */
export declare function toUtcDateOnly(value: Date | string): Date;
export declare function utcDateKey(value: Date | string): string;
/** True when policy end date is strictly before today UTC (expired; inactive from next day). */
export declare function isInsurancePolicyPastEndDate(endDate: Date | string, todayUtc?: Date): boolean;
/** True when policy start date is strictly after today UTC. */
export declare function isInsurancePolicyBeforeStartDate(startDate: Date | string, todayUtc?: Date): boolean;
/** Inclusive range: start_date <= today <= end_date. */
export declare function isTodayWithinInsurancePolicyTerm(startDate: Date | string, endDate: Date | string, todayUtc?: Date): boolean;
export declare function validatePrimaryPolicyDateRange(startDate: Date | string, endDate: Date | string): void;
/** Primary policy is in effect today (Active-eligible by dates). */
export declare function isPrimaryPolicyEffectivelyActive(args: {
    status: string | null | undefined;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): boolean;
/** Primary policy can be assigned to a customer today. */
export declare function isPrimaryPolicyAssignable(args: {
    status: string | null | undefined;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): boolean;
/** Prisma where: Primary policy with status Active and in term on asOfDate (UTC). */
export declare function primaryEffectivelyActivePrismaWhere(asOfDate?: Date): {
    policy_kind: "Primary";
    status: "Active";
    start_date: {
        lte: Date;
    };
    end_date: {
        gte: Date;
    };
};
/** TopUp insurance policy is effectively active today (Active + assignable parent). */
export declare function isTopUpInsurancePolicyEffectivelyActive(args: {
    topUpStatus: string | null | undefined;
    parentPolicyId?: number | null;
    parentStatus?: string | null;
    parentStartDate?: Date | string | null;
    parentEndDate?: Date | string | null;
    todayUtc?: Date;
}): boolean;
/** Prisma where: TopUp policy Active with assignable Primary parent on asOfDate (UTC). */
export declare function topUpEffectivelyActivePrismaWhere(asOfDate?: Date): {
    policy_kind: "TopUp";
    status: "Active";
    ParentInsurancePolicy: {
        is: {
            status: "Active";
            start_date: {
                lte: Date;
            };
            end_date: {
                gte: Date;
            };
        };
    };
};
/** Prisma where: Primary or TopUp effectively active on asOfDate (UTC). */
export declare function effectivelyActivePrismaWhere(asOfDate?: Date): {
    OR: ({
        policy_kind: "Primary";
        status: "Active";
        start_date: {
            lte: Date;
        };
        end_date: {
            gte: Date;
        };
    } | {
        policy_kind: "TopUp";
        status: "Active";
        ParentInsurancePolicy: {
            is: {
                status: "Active";
                start_date: {
                    lte: Date;
                };
                end_date: {
                    gte: Date;
                };
            };
        };
    })[];
};
export declare function canSetInsurancePolicyStatusActive(startDate: Date | string, endDate: Date | string, todayUtc?: Date): boolean;
/**
 * Resolve auto_activate_on_term_start for Primary policies on save.
 * TopUp policies always false. Active/Draft → false.
 * Inactive with future start → body flag or default true.
 * Inactive within term → false (manual activation only).
 */
export declare function resolveAutoActivateOnTermStart(args: {
    policyKind: "Primary" | "TopUp";
    status: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    bodyFlag?: boolean | null;
    todayUtc?: Date;
}): boolean;
/**
 * Resolve status on policy update: block Active when outside the policy term.
 * Does not auto-activate when end_date is extended while Inactive.
 */
export declare function resolveInsurancePolicyStatusOnUpdate(args: {
    policyKind: "Primary" | "TopUp";
    requestedStatus: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): InsurancePolicyLifecycleStatus;
/** Validate status on create (Primary policies). */
export declare function resolveInsurancePolicyStatusOnCreate(args: {
    policyKind: "Primary" | "TopUp";
    requestedStatus: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): InsurancePolicyLifecycleStatus;
/** True when end_date was extended into a valid term while status remains Inactive. */
export declare function shouldNotifyPolicyEligibleForActivation(args: {
    policyKind: "Primary" | "TopUp";
    previousEndDate: Date | string | null;
    nextEndDate: Date | string;
    startDate: Date | string;
    status: InsurancePolicyLifecycleStatus;
    todayUtc?: Date;
}): boolean;
/** True when Inactive Primary is within term and can be manually activated. */
export declare function isPrimaryPolicyEligibleForManualActivation(args: {
    policyKind: "Primary" | "TopUp";
    status: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): boolean;
