"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEffectiveInsuranceForCustomers = loadEffectiveInsuranceForCustomers;
const domain_db_1 = require("../domain-db");
const customerPolicyTypes_1 = require("./customerPolicyTypes");
/**
 * Load per-customer insurance context from active CustomerPolicy.
 */
async function loadEffectiveInsuranceForCustomers(customerIds) {
    if (customerIds.length === 0) {
        return new Map();
    }
    const [customers, activePolicies] = await Promise.all([
        domain_db_1.prisma.customer.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, overdue_block: true },
        }),
        domain_db_1.prisma.customerPolicy.findMany({
            where: { customer_id: { in: customerIds }, is_active: true },
        }),
    ]);
    const overdueById = new Map(customers.map((c) => [c.id, c.overdue_block]));
    const activeByCustomerId = new Map(activePolicies.map((row) => [row.customer_id, row]));
    const result = new Map();
    for (const customerId of customerIds) {
        const active = activeByCustomerId.get(customerId);
        if (!active) {
            continue;
        }
        const fields = (0, customerPolicyTypes_1.mapCustomerPolicyRow)(active);
        result.set(customerId, {
            id: customerId,
            reporting_days: fields.reporting_days,
            max_allowed_mep: fields.max_allowed_mep,
            mep_cutoff_day_of_month: fields.mep_cutoff_day_of_month,
            mep_substitute_day_of_month: fields.mep_substitute_day_of_month,
            reporting_cutoff_day_of_month: fields.reporting_cutoff_day_of_month,
            reporting_substitute_day_of_month: fields.reporting_substitute_day_of_month,
            payment_term_cutoff_day_of_month: fields.payment_term_cutoff_day_of_month,
            payment_term_substitute_day_of_month: fields.payment_term_substitute_day_of_month,
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
