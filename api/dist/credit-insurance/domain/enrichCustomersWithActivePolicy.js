"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichCustomersWithPolicyScope = enrichCustomersWithPolicyScope;
exports.fetchCustomerIdsWithActiveLinkedPolicy = fetchCustomerIdsWithActiveLinkedPolicy;
exports.enrichCustomersWithActivePolicy = enrichCustomersWithActivePolicy;
const domain_db_1 = require("../domain-db");
const customerPolicyTypes_1 = require("./customerPolicyTypes");
const INSURANCE_POLICY_SELECT = {
    id: true,
    policy_number: true,
    end_date: true,
    score_validity_period_months: true,
    currency: true,
    max_total_cover: true,
    max_total_dcl_sdl_cover: true,
};
function overlayPolicyRow(row, policyRow) {
    const fields = (0, customerPolicyTypes_1.mapCustomerPolicyRow)(policyRow);
    return {
        ...row,
        policy_id: fields.insurance_policy_id,
        is_active: Boolean(policyRow.is_active ?? false),
        limit_type: fields.limit_type,
        outdated_dcl: fields.outdated_dcl,
        approved_limit: fields.approved_limit,
        approved_limit_currency: fields.approved_limit_currency,
        approved_limit_expiration_date: fields.approved_limit_expiration_date,
        zero_limit_date: fields.zero_limit_date,
        credit_score_input_date: fields.credit_score_input_date,
        max_payment_term: fields.max_payment_term,
        max_allowed_mep: fields.max_allowed_mep,
        reporting_days: fields.reporting_days,
        excluded_from_policy: fields.excluded_from_policy,
        policy_exclusion_reason: fields.policy_exclusion_reason,
        credit_score: fields.credit_score,
        active_customer_since: fields.active_customer_since,
        customer_number_policy: fields.customer_number_policy,
        capacity_gap_amount: fields.capacity_gap_amount,
        capacity_gap_amount_date: fields.capacity_gap_amount_date,
        uninsured_amount: fields.uninsured_amount,
        capacity_gap_amount1: fields.capacity_gap_amount1,
        capacity_gap_currency1: fields.capacity_gap_currency1,
        capacity_gap_amount2: fields.capacity_gap_amount2,
        capacity_gap_currency2: fields.capacity_gap_currency2,
        uninsured_amount1: fields.uninsured_amount1,
        uninsured_currency1: fields.uninsured_currency1,
        uninsured_amount2: fields.uninsured_amount2,
        uninsured_currency2: fields.uninsured_currency2,
        InsurancePolicy: policyRow.InsurancePolicy ?? row.InsurancePolicy ?? null,
    };
}
async function enrichCustomersWithPolicyScope(rows, policyId) {
    if (rows.length === 0) {
        return rows;
    }
    const customerIds = rows.map((r) => r.id);
    if (policyId == null) {
        const scopedRows = await domain_db_1.prisma.customerPolicy.findMany({
            where: { customer_id: { in: customerIds }, is_active: true },
            include: { InsurancePolicy: { select: INSURANCE_POLICY_SELECT } },
        });
        const scopedByCustomerId = new Map(scopedRows.map((row) => [row.customer_id, row]));
        const missingCustomerIds = customerIds.filter((id) => !scopedByCustomerId.has(id));
        if (missingCustomerIds.length > 0) {
            const latestRows = await domain_db_1.prisma.customerPolicy.findMany({
                where: {
                    customer_id: { in: missingCustomerIds },
                    insurance_policy_id: { not: null },
                },
                include: { InsurancePolicy: { select: INSURANCE_POLICY_SELECT } },
                orderBy: [
                    { is_active: "desc" },
                    { modified_at: "desc" },
                    { id: "desc" },
                ],
            });
            for (const row of latestRows) {
                if (!scopedByCustomerId.has(row.customer_id)) {
                    scopedByCustomerId.set(row.customer_id, row);
                }
            }
        }
        return rows.map((row) => {
            const scoped = scopedByCustomerId.get(row.id);
            if (!scoped) {
                return {
                    ...row,
                    is_active: row.is_active ?? false,
                };
            }
            return overlayPolicyRow(row, scoped);
        });
    }
    const policyRows = await domain_db_1.prisma.customerPolicy.findMany({
        where: {
            customer_id: { in: customerIds },
            insurance_policy_id: policyId,
        },
        include: { InsurancePolicy: { select: INSURANCE_POLICY_SELECT } },
        orderBy: [{ is_active: "desc" }, { modified_at: "desc" }, { id: "desc" }],
    });
    const policyByCustomerId = new Map();
    for (const row of policyRows) {
        if (!policyByCustomerId.has(row.customer_id)) {
            policyByCustomerId.set(row.customer_id, row);
        }
    }
    return rows.map((row) => {
        const policyRow = policyByCustomerId.get(row.id);
        if (!policyRow) {
            return {
                ...row,
                is_active: row.is_active ?? false,
            };
        }
        return overlayPolicyRow(row, policyRow);
    });
}
async function fetchCustomerIdsWithActiveLinkedPolicy(customerIds) {
    if (customerIds.length === 0) {
        return new Set();
    }
    const rows = await domain_db_1.prisma.customerPolicy.findMany({
        where: {
            customer_id: { in: customerIds },
            is_active: true,
            insurance_policy_id: { not: null },
        },
        select: { customer_id: true },
        distinct: ["customer_id"],
    });
    return new Set(rows.map((row) => row.customer_id));
}
async function enrichCustomersWithActivePolicy(rows) {
    return enrichCustomersWithPolicyScope(rows);
}
//# sourceMappingURL=enrichCustomersWithActivePolicy.js.map