export type InsurancePolicyLifecycleStatus = "Active" | "Inactive" | "Draft";
export declare const TOPUP_POLICY_PLACEHOLDER_START: Date;
export declare const TOPUP_POLICY_PLACEHOLDER_END: Date;
export declare const TOPUP_PARENT_SYNC_ACTOR = "system:parent_policy_status_sync";
export declare function startOfTodayUtc(from?: Date): Date;
export declare function toUtcDateOnly(value: Date | string): Date;
export declare function utcDateKey(value: Date | string): string;
export declare function isInsurancePolicyPastEndDate(endDate: Date | string, todayUtc?: Date): boolean;
export declare function isInsurancePolicyBeforeStartDate(startDate: Date | string, todayUtc?: Date): boolean;
export declare function isTodayWithinInsurancePolicyTerm(startDate: Date | string, endDate: Date | string, todayUtc?: Date): boolean;
export declare function validatePrimaryPolicyDateRange(startDate: Date | string, endDate: Date | string): void;
export declare function isPrimaryPolicyEffectivelyActive(args: {
    status: string | null | undefined;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): boolean;
export declare function isPrimaryPolicyAssignable(args: {
    status: string | null | undefined;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): boolean;
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
export declare function isTopUpInsurancePolicyEffectivelyActive(args: {
    topUpStatus: string | null | undefined;
    parentPolicyId?: number | null;
    parentStatus?: string | null;
    parentStartDate?: Date | string | null;
    parentEndDate?: Date | string | null;
    todayUtc?: Date;
}): boolean;
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
export declare function resolveAutoActivateOnTermStart(args: {
    policyKind: "Primary" | "TopUp";
    status: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    bodyFlag?: boolean | null;
    todayUtc?: Date;
}): boolean;
export declare function resolveInsurancePolicyStatusOnUpdate(args: {
    policyKind: "Primary" | "TopUp";
    requestedStatus: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): InsurancePolicyLifecycleStatus;
export declare function resolveInsurancePolicyStatusOnCreate(args: {
    policyKind: "Primary" | "TopUp";
    requestedStatus: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): InsurancePolicyLifecycleStatus;
export declare function shouldNotifyPolicyEligibleForActivation(args: {
    policyKind: "Primary" | "TopUp";
    previousEndDate: Date | string | null;
    nextEndDate: Date | string;
    startDate: Date | string;
    status: InsurancePolicyLifecycleStatus;
    todayUtc?: Date;
}): boolean;
export declare function isPrimaryPolicyEligibleForManualActivation(args: {
    policyKind: "Primary" | "TopUp";
    status: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): boolean;
