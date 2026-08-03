import type { Prisma } from "@prisma/client";
type InsurancePolicySummary = {
    id: number;
    policy_number: string | null;
    end_date: Date;
    score_validity_period_months: number | null;
    currency: string | null;
    max_total_cover: Prisma.Decimal | null;
    max_total_dcl_sdl_cover: Prisma.Decimal | null;
};
export type EnrichedCustomerPolicyFields = {
    policy_id: number | null;
    /** Active CustomerPolicy row overlay; false when no matching row. */
    is_active: boolean;
    limit_type: string | null;
    outdated_dcl: boolean | null;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency: string | null;
    approved_limit_expiration_date: Date | null;
    zero_limit_date: Date | null;
    credit_score_input_date: Date | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
    excluded_from_policy: boolean;
    policy_exclusion_reason: string | null;
    credit_score: Prisma.Decimal | null;
    active_customer_since: Date | null;
    customer_number_policy: string | null;
    capacity_gap_amount: number | null;
    capacity_gap_amount_date: Date | null;
    uninsured_amount: number | null;
    capacity_gap_amount1: number | null;
    capacity_gap_currency1: string | null;
    capacity_gap_amount2: number | null;
    capacity_gap_currency2: string | null;
    uninsured_amount1: number | null;
    uninsured_currency1: string | null;
    uninsured_amount2: number | null;
    uninsured_currency2: string | null;
};
/**
 * Overlay CustomerPolicy fields onto customer rows for dashboard/KPI reads.
 * Customers without a matching policy row are returned unchanged (no policy fields).
 */
export type CustomerWithEnrichedPolicy<T extends {
    id: number;
}> = T & EnrichedCustomerPolicyFields & {
    InsurancePolicy?: InsurancePolicySummary | null;
};
/**
 * Overlay CustomerPolicy fields for dashboard policy scope.
 * When policyId is set, uses the matching insurance_policy_id row (active first, else latest inactive).
 * When policyId is null, uses the active CustomerPolicy row only.
 */
export declare function enrichCustomersWithPolicyScope<T extends {
    id: number;
} & Partial<EnrichedCustomerPolicyFields> & {
    InsurancePolicy?: InsurancePolicySummary | null;
}>(rows: T[], policyId?: number): Promise<CustomerWithEnrichedPolicy<T>[]>;
/** Customer ids with an active CustomerPolicy row linked to an insurance policy. */
export declare function fetchCustomerIdsWithActiveLinkedPolicy(customerIds: number[]): Promise<Set<number>>;
/** @deprecated Prefer {@link enrichCustomersWithPolicyScope} with explicit policyId for dashboard reads. */
export declare function enrichCustomersWithActivePolicy<T extends {
    id: number;
} & Partial<EnrichedCustomerPolicyFields> & {
    InsurancePolicy?: InsurancePolicySummary | null;
}>(rows: T[]): Promise<CustomerWithEnrichedPolicy<T>[]>;
export {};
