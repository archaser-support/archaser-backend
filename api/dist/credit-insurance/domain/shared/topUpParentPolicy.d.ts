export declare function isEligibleTopUpParentPolicy(policy: {
    policy_kind?: string | null;
    status?: string | null;
    start_date?: Date | string | null;
    end_date?: Date | string | null;
}, todayUtc?: Date): boolean;
export declare function filterTopUpParentPolicyOptions<T extends {
    id: number;
    policy_kind?: string | null;
    status?: string | null;
    start_date?: Date | string | null;
    end_date?: Date | string | null;
}>(policies: T[], options?: {
    excludePolicyId?: number;
    todayUtc?: Date;
}): T[];
