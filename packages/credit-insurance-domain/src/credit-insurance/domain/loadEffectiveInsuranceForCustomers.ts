import { prisma } from "../domain-db";
import type { Prisma } from "@prisma/client";

import { mapCustomerPolicyRow } from "./customerPolicyTypes";

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
export async function loadEffectiveInsuranceForCustomers(
    customerIds: number[]
): Promise<Map<number, InvoiceInsuranceCustomerContext>> {
    if (customerIds.length === 0) {
        return new Map();
    }

    const [customers, activePolicies] = await Promise.all([
        prisma.customer.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, overdue_block: true },
        }),
        prisma.customerPolicy.findMany({
            where: { customer_id: { in: customerIds }, is_active: true },
        }),
    ]);

    const overdueById = new Map(
        customers.map((c) => [c.id, c.overdue_block])
    );
    const activeByCustomerId = new Map(
        activePolicies.map((row) => [row.customer_id, row])
    );

    const result = new Map<number, InvoiceInsuranceCustomerContext>();

    for (const customerId of customerIds) {
        const active = activeByCustomerId.get(customerId);
        if (!active) {
            continue;
        }
        const fields = mapCustomerPolicyRow(active);
        result.set(customerId, {
            id: customerId,
            reporting_days: fields.reporting_days,
            max_allowed_mep: fields.max_allowed_mep,
            mep_cutoff_day_of_month: fields.mep_cutoff_day_of_month,
            mep_substitute_day_of_month: fields.mep_substitute_day_of_month,
            reporting_cutoff_day_of_month: fields.reporting_cutoff_day_of_month,
            reporting_substitute_day_of_month: fields.reporting_substitute_day_of_month,
            payment_term_cutoff_day_of_month:
                fields.payment_term_cutoff_day_of_month,
            payment_term_substitute_day_of_month:
                fields.payment_term_substitute_day_of_month,
            max_payment_term: fields.max_payment_term,
            overdue_block: overdueById.get(customerId) ?? false,
            excluded_from_policy: fields.excluded_from_policy,
            policy_exclusion_reason: fields.policy_exclusion_reason,
            credit_score_input_date: fields.credit_score_input_date,
            policy_id: fields.insurance_policy_id,
            limit_type: fields.limit_type,
            credit_score: fields.credit_score,
            active_customer_since: fields.active_customer_since,
            approved_limit: fields.approved_limit,
            approved_limit_currency: fields.approved_limit_currency,
        });
    }

    return result;
}
