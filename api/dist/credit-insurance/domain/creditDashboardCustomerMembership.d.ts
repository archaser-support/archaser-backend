import type { Prisma } from "@prisma/client";
export type CreditCustomerMembershipType = "capacity" | "policy_risk" | "limit_warning" | "zero_limit_warning" | "no_policy_exposure" | "top_up" | "top_up_expiring";
export interface CreditCustomerMembershipOptions {
    policyId?: number;
    customerId?: number;
    includeNoPolicyExposure?: boolean;
    withinDays?: number;
}
export declare function zeroLimitWarningMembershipWhere(options?: Pick<CreditCustomerMembershipOptions, "policyId">): Prisma.CustomerWhereInput;
export declare function resolveCreditCustomerMembershipIds(type: CreditCustomerMembershipType, accountId: number, options?: CreditCustomerMembershipOptions): Promise<number[] | null>;
