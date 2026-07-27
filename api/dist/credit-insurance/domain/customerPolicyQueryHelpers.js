"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVE_CUSTOMER_POLICY_NESTED_SELECT = exports.COLLECTION_LIVE = void 0;
exports.customerActivePolicyFilter = customerActivePolicyFilter;
exports.customersScopedByActivePolicy = customersScopedByActivePolicy;
exports.customersWithActiveCustomerPolicyFilter = customersWithActiveCustomerPolicyFilter;
exports.customersScopedForCreditDashboard = customersScopedForCreditDashboard;
exports.hasDashboardBusinessUnitScope = hasDashboardBusinessUnitScope;
exports.mergeDashboardBusinessUnitIntoCustomerScope = mergeDashboardBusinessUnitIntoCustomerScope;
exports.customersScopedForCreditDashboardWithBusinessUnit = customersScopedForCreditDashboardWithBusinessUnit;
exports.applyBusinessUnitFilterToInvoiceWhere = applyBusinessUnitFilterToInvoiceWhere;
exports.customersScopedByPolicyInvoicesOrActive = customersScopedByPolicyInvoicesOrActive;
exports.withInvoiceCustomerPolicyFilter = withInvoiceCustomerPolicyFilter;
exports.insurancePolicyAssignedToLiveCustomersFilter = insurancePolicyAssignedToLiveCustomersFilter;
exports.customerPolicyTextSearchOr = customerPolicyTextSearchOr;
exports.policyDisplayFromCustomerRow = policyDisplayFromCustomerRow;
exports.policyDisplayFromInvoiceRow = policyDisplayFromInvoiceRow;
exports.invoiceLinkedPolicyTextSearchOr = invoiceLinkedPolicyTextSearchOr;
const client_1 = require("@prisma/client");
exports.COLLECTION_LIVE = [
    client_1.record_status.Active,
    client_1.record_status.Inactive,
];
const OPEN_RECEIVABLE_STATUSES = {
    in: ["Due", "Overdue"],
};
function customerActivePolicyFilter(policyId) {
    return {
        CustomerPolicy: {
            some: { is_active: true, insurance_policy_id: policyId },
        },
    };
}
function customersScopedByActivePolicy(accountId, policyId) {
    return {
        account_id: accountId,
        collection_status: { in: exports.COLLECTION_LIVE },
        ...(policyId != null ? customerActivePolicyFilter(policyId) : {}),
    };
}
function customersWithActiveCustomerPolicyFilter() {
    return {
        CustomerPolicy: {
            some: {
                is_active: true,
                insurance_policy_id: { not: null },
            },
        },
    };
}
function customersScopedForCreditDashboard(accountId, policyId) {
    if (policyId != null) {
        return customersScopedByPolicyInvoicesOrActive(accountId, policyId);
    }
    return {
        account_id: accountId,
        collection_status: { in: exports.COLLECTION_LIVE },
        OR: [
            customersWithActiveCustomerPolicyFilter(),
            {
                Invoice: {
                    some: {
                        account_id: accountId,
                        status: OPEN_RECEIVABLE_STATUSES,
                    },
                },
            },
        ],
    };
}
function hasDashboardBusinessUnitScope(businessUnitFilter) {
    return Boolean(businessUnitFilter && Object.keys(businessUnitFilter).length > 0);
}
function mergeDashboardBusinessUnitIntoCustomerScope(customerScope, businessUnitFilter) {
    if (!hasDashboardBusinessUnitScope(businessUnitFilter)) {
        return customerScope;
    }
    return {
        AND: [customerScope, businessUnitFilter],
    };
}
function customersScopedForCreditDashboardWithBusinessUnit(accountId, policyId, businessUnitFilter) {
    return mergeDashboardBusinessUnitIntoCustomerScope(customersScopedForCreditDashboard(accountId, policyId), businessUnitFilter);
}
function applyBusinessUnitFilterToInvoiceWhere(where, businessUnitFilter) {
    if (!hasDashboardBusinessUnitScope(businessUnitFilter)) {
        return where;
    }
    return {
        AND: [where, { Customer: businessUnitFilter }],
    };
}
function customersScopedByPolicyInvoicesOrActive(accountId, policyId) {
    return {
        account_id: accountId,
        collection_status: { in: exports.COLLECTION_LIVE },
        OR: [
            customerActivePolicyFilter(policyId),
            {
                Invoice: {
                    some: {
                        account_id: accountId,
                        policy_id: policyId,
                        status: OPEN_RECEIVABLE_STATUSES,
                    },
                },
            },
        ],
    };
}
function withInvoiceCustomerPolicyFilter(where, policyId) {
    if (policyId == null) {
        return where;
    }
    return {
        AND: [where, { policy_id: policyId }],
    };
}
function insurancePolicyAssignedToLiveCustomersFilter(accountId) {
    return {
        CustomerPolicy: {
            some: {
                is_active: true,
                Customer: {
                    account_id: accountId,
                    collection_status: { in: exports.COLLECTION_LIVE },
                },
            },
        },
    };
}
function customerPolicyTextSearchOr(t) {
    return [
        { customer_number: { contains: t, mode: "insensitive" } },
        { Person: { full_name: { contains: t, mode: "insensitive" } } },
        { Company: { name: { contains: t, mode: "insensitive" } } },
        {
            CustomerPolicy: {
                some: {
                    is_active: true,
                    OR: [
                        {
                            customer_number_policy: {
                                contains: t,
                                mode: "insensitive",
                            },
                        },
                        {
                            InsurancePolicy: {
                                policy_number: {
                                    contains: t,
                                    mode: "insensitive",
                                },
                            },
                        },
                    ],
                },
            },
        },
    ];
}
exports.ACTIVE_CUSTOMER_POLICY_NESTED_SELECT = {
    where: { is_active: true },
    take: 1,
    select: {
        customer_number_policy: true,
        approved_limit: true,
        approved_limit_currency: true,
        limit_type: true,
        outdated_dcl: true,
        insurance_policy_id: true,
        InsurancePolicy: {
            select: { policy_number: true, currency: true },
        },
    },
};
function policyDisplayFromCustomerRow(customer) {
    const active = customer.CustomerPolicy?.[0];
    const ip = customer.InsurancePolicy ?? active?.InsurancePolicy ?? null;
    return {
        policy_number: ip?.policy_number ?? null,
        currency: ip?.currency ?? null,
        customer_number_policy: active?.customer_number_policy ??
            customer.customer_number_policy ??
            null,
    };
}
function policyDisplayFromInvoiceRow(invoice, customer) {
    if (invoice.InsurancePolicy != null) {
        const fromCustomer = policyDisplayFromCustomerRow(customer);
        return {
            policy_number: invoice.InsurancePolicy.policy_number ?? null,
            currency: invoice.InsurancePolicy.currency ?? null,
            customer_number_policy: fromCustomer.customer_number_policy,
        };
    }
    return policyDisplayFromCustomerRow(customer);
}
function invoiceLinkedPolicyTextSearchOr(t) {
    return {
        InsurancePolicy: {
            is: {
                policy_number: { contains: t, mode: "insensitive" },
            },
        },
    };
}
//# sourceMappingURL=customerPolicyQueryHelpers.js.map