import { DbClient, prisma } from "../domain-db";
import type { Prisma } from "@prisma/client";

import {
    emptyEffectiveCustomerPolicyFields,
    type EffectiveCustomerPolicyFields,
    mapCustomerPolicyRow,
} from "./customerPolicyTypes";

const ACTIVE_POLICY_SELECT = {
    id: true,
    customer_id: true,
    insurance_policy_id: true,
    customer_number_policy: true,
    approved_limit: true,
    approved_limit_currency: true,
    approved_limit_expiration_date: true,
    zero_limit_date: true,
    limit_type: true,
    max_payment_term: true,
    max_allowed_mep: true,
    reporting_days: true,
    mep_cutoff_day_of_month: true,
    mep_substitute_day_of_month: true,
    reporting_cutoff_day_of_month: true,
    reporting_substitute_day_of_month: true,
    payment_term_cutoff_day_of_month: true,
    payment_term_substitute_day_of_month: true,
    excluded_from_policy: true,
    policy_exclusion_reason: true,
    credit_score: true,
    credit_score_input_date: true,
    active_customer_since: true,
    outdated_dcl: true,
    capacity_gap_amount: true,
    capacity_gap_amount_date: true,
    uninsured_amount: true,
    capacity_gap_amount1: true,
    capacity_gap_currency1: true,
    capacity_gap_amount2: true,
    capacity_gap_currency2: true,
    uninsured_amount1: true,
    uninsured_currency1: true,
    uninsured_amount2: true,
    uninsured_currency2: true,
    is_active: true,
    created_at: true,
    modified_at: true,
    modified_by: true,
    User_CustomerPolicy_modified_byToUser: {
        select: {
            id: true,
            name: true,
            first_name: true,
            last_name: true,
            email: true,
        },
    },
} satisfies Prisma.CustomerPolicySelect;

export async function getActiveCustomerPolicyRow(
    customerId: number,
    dbClient: DbClient = prisma
) {
    return dbClient.customerPolicy.findFirst({
        where: { customer_id: customerId, is_active: true },
        select: ACTIVE_POLICY_SELECT,
    });
}

export async function listCustomerPolicyHistory(customerId: number) {
    return prisma.customerPolicy.findMany({
        where: { customer_id: customerId },
        select: {
            ...ACTIVE_POLICY_SELECT,
            InsurancePolicy: {
                select: {
                    id: true,
                    policy_number: true,
                    status: true,
                    start_date: true,
                    end_date: true,
                },
            },
        },
        orderBy: [{ is_active: "desc" }, { modified_at: "desc" }, { id: "desc" }],
    });
}

/** Resolve effective policy fields from active CustomerPolicy only. */
export async function resolveEffectiveCustomerPolicy(
    customerId: number,
    dbClient: DbClient = prisma
): Promise<EffectiveCustomerPolicyFields> {
    const active = await getActiveCustomerPolicyRow(customerId, dbClient);
    if (active) {
        return mapCustomerPolicyRow(active);
    }
    return emptyEffectiveCustomerPolicyFields();
}

export async function resolveEffectiveCustomerPolicyByCustomerId(
    customerId: number,
    dbClient: DbClient = prisma
): Promise<EffectiveCustomerPolicyFields | null> {
    const customer = await dbClient.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
    });
    if (!customer) {
        return null;
    }
    return resolveEffectiveCustomerPolicy(customerId, dbClient);
}

/** Active insurance policy id for invoice linkage. */
export async function resolveActiveInsurancePolicyIdForCustomer(
    customerId: number,
    dbClient: DbClient = prisma
): Promise<number | null> {
    const fields = await resolveEffectiveCustomerPolicyByCustomerId(
        customerId,
        dbClient
    );
    return fields?.insurance_policy_id ?? null;
}
