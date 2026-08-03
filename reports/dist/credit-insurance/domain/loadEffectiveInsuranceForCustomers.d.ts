import type { Prisma } from "@prisma/client";
/** Shape used by invoice insurance row computation. */
export type InvoiceInsuranceCustomerContext = {
    id: number;
    reporting_days: number | null;
    max_allowed_mep: number | null;
    mep_cutoff_day_of_month: number | null;
    mep_substitute_day_of_month: number | null;
    reporting_cutoff_day_of_month: number | null;
    reporting_substitute_day_of_month: number | null;
    payment_term_cutoff_day_of_month: number | null;
    payment_term_substitute_day_of_month: number | null;
    max_payment_term: number | null;
    overdue_block: boolean;
    excluded_from_policy: boolean;
    policy_exclusion_reason: string | null;
    credit_score_input_date: Date | null;
    policy_id: number | null;
    limit_type: string | null;
    credit_score: Prisma.Decimal | null;
    active_customer_since: Date | null;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency: string | null;
};
/**
 * Load per-customer insurance context from active CustomerPolicy.
 */
export declare function loadEffectiveInsuranceForCustomers(customerIds: number[]): Promise<Map<number, InvoiceInsuranceCustomerContext>>;
