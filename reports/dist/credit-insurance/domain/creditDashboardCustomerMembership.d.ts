/**
 * Credit dashboard customer-grain membership IDs / where fragments for
 * ViewBased report execute (exact KPI parity with get*Report).
 *
 * BU is intentionally omitted — report execute applies businessUnitFilter.
 */
import type { Prisma } from "@prisma/client";
export type CreditCustomerMembershipType = "capacity" | "policy_risk" | "limit_warning" | "zero_limit_warning" | "no_policy_exposure" | "top_up" | "top_up_expiring";
export interface CreditCustomerMembershipOptions {
    policyId?: number;
    customerId?: number;
    /** Only for no_policy_exposure; default true. */
    includeNoPolicyExposure?: boolean;
    /** Only for top_up_expiring; default 30. */
    withinDays?: number;
}
/**
 * Prisma fragment for zero-limit warning (active CustomerPolicy with approved_limit=0).
 * Combined with credit customer scope in the execute expander.
 */
export declare function zeroLimitWarningMembershipWhere(options?: Pick<CreditCustomerMembershipOptions, "policyId">): Prisma.CustomerWhereInput;
/**
 * Resolve customer IDs for capacity / policy_risk / limit_warning / no_policy_exposure.
 * Returns null for types that use a where fragment instead (zero_limit_warning).
 */
export declare function resolveCreditCustomerMembershipIds(type: CreditCustomerMembershipType, accountId: number, options?: CreditCustomerMembershipOptions): Promise<number[] | null>;
