import type { customer_limit_type } from "@prisma/client";
import { Prisma } from "@prisma/client";

/** Row shape from active/history CustomerPolicy selects (not full model). */
export type CustomerPolicyRowSelected = {
    id: number;
    insurance_policy_id: number | null;
    customer_number_policy: string | null;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency: string | null;
    approved_limit_expiration_date: Date | null;
    zero_limit_date: Date | null;
    limit_type: customer_limit_type | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
    mep_cutoff_day_of_month: number | null;
    mep_substitute_day_of_month: number | null;
    reporting_cutoff_day_of_month: number | null;
    reporting_substitute_day_of_month: number | null;
    payment_term_cutoff_day_of_month: number | null;
    payment_term_substitute_day_of_month: number | null;
    excluded_from_policy: boolean;
    policy_exclusion_reason: string | null;
    credit_score: Prisma.Decimal | null;
    credit_score_input_date: Date | null;
    active_customer_since: Date | null;
    outdated_dcl: boolean;
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

/** Policy fields used across credit-insurance computations (active CustomerPolicy row). */
export type EffectiveCustomerPolicyFields = {
    customerPolicyRowId: number | null;
    insurance_policy_id: number | null;
    customer_number_policy: string | null;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency: string | null;
    approved_limit_expiration_date: Date | null;
    zero_limit_date: Date | null;
    limit_type: customer_limit_type | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
    mep_cutoff_day_of_month: number | null;
    mep_substitute_day_of_month: number | null;
    reporting_cutoff_day_of_month: number | null;
    reporting_substitute_day_of_month: number | null;
    payment_term_cutoff_day_of_month: number | null;
    payment_term_substitute_day_of_month: number | null;
    excluded_from_policy: boolean;
    policy_exclusion_reason: string | null;
    credit_score: Prisma.Decimal | null;
    credit_score_input_date: Date | null;
    active_customer_since: Date | null;
    outdated_dcl: boolean;
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

export type CustomerPolicyWriteInput = {
    insurance_policy_id?: number | null;
    customer_number_policy?: string | null;
    approved_limit?: Prisma.Decimal | string | number | null;
    approved_limit_currency?: string | null;
    approved_limit_expiration_date?: Date | null;
    zero_limit_date?: Date | null;
    limit_type?: customer_limit_type | null;
    max_payment_term?: number | null;
    max_allowed_mep?: number | null;
    reporting_days?: number | null;
    mep_cutoff_day_of_month?: number | null;
    mep_substitute_day_of_month?: number | null;
    reporting_cutoff_day_of_month?: number | null;
    reporting_substitute_day_of_month?: number | null;
    payment_term_cutoff_day_of_month?: number | null;
    payment_term_substitute_day_of_month?: number | null;
    excluded_from_policy?: boolean;
    policy_exclusion_reason?: string | null;
    credit_score?: Prisma.Decimal | string | number | null;
    credit_score_input_date?: Date | null;
    active_customer_since?: Date | null;
    outdated_dcl?: boolean;
};

export function emptyEffectiveCustomerPolicyFields(): EffectiveCustomerPolicyFields {
    return {
        customerPolicyRowId: null,
        insurance_policy_id: null,
        customer_number_policy: null,
        approved_limit: null,
        approved_limit_currency: null,
        approved_limit_expiration_date: null,
        zero_limit_date: null,
        limit_type: null,
        max_payment_term: null,
        max_allowed_mep: null,
        reporting_days: null,
        mep_cutoff_day_of_month: null,
        mep_substitute_day_of_month: null,
        reporting_cutoff_day_of_month: null,
        reporting_substitute_day_of_month: null,
        payment_term_cutoff_day_of_month: null,
        payment_term_substitute_day_of_month: null,
        excluded_from_policy: false,
        policy_exclusion_reason: null,
        credit_score: null,
        credit_score_input_date: null,
        active_customer_since: null,
        outdated_dcl: false,
        capacity_gap_amount: null,
        capacity_gap_amount_date: null,
        uninsured_amount: null,
        capacity_gap_amount1: null,
        capacity_gap_currency1: null,
        capacity_gap_amount2: null,
        capacity_gap_currency2: null,
        uninsured_amount1: null,
        uninsured_currency1: null,
        uninsured_amount2: null,
        uninsured_currency2: null,
    };
}

export function mapCustomerPolicyRow(
    row: CustomerPolicyRowSelected
): EffectiveCustomerPolicyFields {
    return {
        customerPolicyRowId: row.id,
        insurance_policy_id: row.insurance_policy_id,
        customer_number_policy: row.customer_number_policy,
        approved_limit: row.approved_limit,
        approved_limit_currency: row.approved_limit_currency,
        approved_limit_expiration_date: row.approved_limit_expiration_date,
        zero_limit_date: row.zero_limit_date,
        limit_type: row.limit_type,
        max_payment_term: row.max_payment_term,
        max_allowed_mep: row.max_allowed_mep,
        reporting_days: row.reporting_days,
        mep_cutoff_day_of_month: row.mep_cutoff_day_of_month,
        mep_substitute_day_of_month: row.mep_substitute_day_of_month,
        reporting_cutoff_day_of_month: row.reporting_cutoff_day_of_month,
        reporting_substitute_day_of_month: row.reporting_substitute_day_of_month,
        payment_term_cutoff_day_of_month: row.payment_term_cutoff_day_of_month,
        payment_term_substitute_day_of_month:
            row.payment_term_substitute_day_of_month,
        excluded_from_policy: row.excluded_from_policy,
        policy_exclusion_reason: row.policy_exclusion_reason,
        credit_score: row.credit_score,
        credit_score_input_date: row.credit_score_input_date,
        active_customer_since: row.active_customer_since,
        outdated_dcl: row.outdated_dcl,
        capacity_gap_amount: row.capacity_gap_amount,
        capacity_gap_amount_date: row.capacity_gap_amount_date,
        uninsured_amount: row.uninsured_amount,
        capacity_gap_amount1: row.capacity_gap_amount1,
        capacity_gap_currency1: row.capacity_gap_currency1,
        capacity_gap_amount2: row.capacity_gap_amount2,
        capacity_gap_currency2: row.capacity_gap_currency2,
        uninsured_amount1: row.uninsured_amount1,
        uninsured_currency1: row.uninsured_currency1,
        uninsured_amount2: row.uninsured_amount2,
        uninsured_currency2: row.uninsured_currency2,
    };
}

/** Flatten effective policy fields onto API customer payloads (display only). */
export function effectivePolicyFieldsToCustomerDisplay(
    fields: EffectiveCustomerPolicyFields
): Record<string, unknown> {
    return {
        policy_id: fields.insurance_policy_id,
        customer_number_policy: fields.customer_number_policy,
        approved_limit: fields.approved_limit,
        approved_limit_currency: fields.approved_limit_currency,
        approved_limit_expiration_date: fields.approved_limit_expiration_date,
        zero_limit_date: fields.zero_limit_date,
        limit_type: fields.limit_type,
        max_payment_term: fields.max_payment_term,
        max_allowed_mep: fields.max_allowed_mep,
        reporting_days: fields.reporting_days,
        mep_cutoff_day_of_month: fields.mep_cutoff_day_of_month,
        mep_substitute_day_of_month: fields.mep_substitute_day_of_month,
        reporting_cutoff_day_of_month: fields.reporting_cutoff_day_of_month,
        reporting_substitute_day_of_month: fields.reporting_substitute_day_of_month,
        payment_term_cutoff_day_of_month: fields.payment_term_cutoff_day_of_month,
        payment_term_substitute_day_of_month:
            fields.payment_term_substitute_day_of_month,
        excluded_from_policy: fields.excluded_from_policy,
        policy_exclusion_reason: fields.policy_exclusion_reason,
        credit_score: fields.credit_score,
        credit_score_input_date: fields.credit_score_input_date,
        active_customer_since: fields.active_customer_since,
        outdated_dcl: fields.outdated_dcl,
    };
}
