import type { Prisma } from "@prisma/client";
import { record_status } from "@prisma/client";

/** Live collection customers (credit dashboard scope). */
export const COLLECTION_LIVE: record_status[] = [
    record_status.Active,
    record_status.Inactive,
];

const OPEN_RECEIVABLE_STATUSES: Prisma.Enuminvoice_statusFilter = {
    in: ["Due", "Overdue"],
};

/** Customer filter: active CustomerPolicy links to the given insurance policy. */
export function customerActivePolicyFilter(
    policyId: number
): Prisma.CustomerWhereInput {
    return {
        CustomerPolicy: {
            some: { is_active: true, insurance_policy_id: policyId },
        },
    };
}

export function customersScopedByActivePolicy(
    accountId: number,
    policyId?: number
): Prisma.CustomerWhereInput {
    return {
        account_id: accountId,
        collection_status: { in: COLLECTION_LIVE },
        ...(policyId != null ? customerActivePolicyFilter(policyId) : {}),
    };
}

/** Live customers with an active CustomerPolicy row (any insurance policy). */
export function customersWithActiveCustomerPolicyFilter(): Prisma.CustomerWhereInput {
    return {
        CustomerPolicy: {
            some: {
                is_active: true,
                insurance_policy_id: { not: null },
            },
        },
    };
}

/**
 * Credit dashboard customer scope: policy filter uses invoices + active policy;
 * portfolio ("All Policies") includes any live customer with open receivables
 * (Due/Overdue) or an active linked CustomerPolicy.
 */
export function customersScopedForCreditDashboard(
    accountId: number,
    policyId?: number
): Prisma.CustomerWhereInput {
    if (policyId != null) {
        return customersScopedByPolicyInvoicesOrActive(accountId, policyId);
    }
    return {
        account_id: accountId,
        collection_status: { in: COLLECTION_LIVE },
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

export function hasDashboardBusinessUnitScope(
    businessUnitFilter?: Prisma.CustomerWhereInput
): boolean {
    return Boolean(
        businessUnitFilter && Object.keys(businessUnitFilter).length > 0
    );
}

/** AND dashboard BU resolver output onto credit dashboard customer scope. */
export function mergeDashboardBusinessUnitIntoCustomerScope(
    customerScope: Prisma.CustomerWhereInput,
    businessUnitFilter?: Prisma.CustomerWhereInput
): Prisma.CustomerWhereInput {
    if (!hasDashboardBusinessUnitScope(businessUnitFilter)) {
        return customerScope;
    }
    return {
        AND: [customerScope, businessUnitFilter!],
    };
}

export function customersScopedForCreditDashboardWithBusinessUnit(
    accountId: number,
    policyId?: number,
    businessUnitFilter?: Prisma.CustomerWhereInput
): Prisma.CustomerWhereInput {
    return mergeDashboardBusinessUnitIntoCustomerScope(
        customersScopedForCreditDashboard(accountId, policyId),
        businessUnitFilter
    );
}

export function applyBusinessUnitFilterToInvoiceWhere(
    where: Prisma.InvoiceWhereInput,
    businessUnitFilter?: Prisma.CustomerWhereInput
): Prisma.InvoiceWhereInput {
    if (!hasDashboardBusinessUnitScope(businessUnitFilter)) {
        return where;
    }
    return {
        AND: [where, { Customer: businessUnitFilter! }],
    };
}

/**
 * Policy-scoped customer list: active CustomerPolicy on the policy OR open invoices tagged with policy_id.
 */
export function customersScopedByPolicyInvoicesOrActive(
    accountId: number,
    policyId: number
): Prisma.CustomerWhereInput {
    return {
        account_id: accountId,
        collection_status: { in: COLLECTION_LIVE },
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

export function withInvoiceCustomerPolicyFilter(
    where: Prisma.InvoiceWhereInput,
    policyId?: number
): Prisma.InvoiceWhereInput {
    if (policyId == null) {
        return where;
    }
    return {
        AND: [where, { policy_id: policyId }],
    };
}

/** Policies with at least one live customer on active CustomerPolicy. */
export function insurancePolicyAssignedToLiveCustomersFilter(
    accountId: number
): Prisma.InsurancePolicyWhereInput {
    return {
        CustomerPolicy: {
            some: {
                is_active: true,
                Customer: {
                    account_id: accountId,
                    collection_status: { in: COLLECTION_LIVE },
                },
            },
        },
    };
}

/** Text search on customer number, name, and active policy fields. */
export function customerPolicyTextSearchOr(
    t: string
): Prisma.CustomerWhereInput[] {
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

/** Active CustomerPolicy + InsurancePolicy for nested Customer selects. */
export const ACTIVE_CUSTOMER_POLICY_NESTED_SELECT = {
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
} as const;

export function policyDisplayFromCustomerRow(customer: {
    CustomerPolicy?: Array<{
        InsurancePolicy?: { policy_number: string | null; currency?: string | null } | null;
        customer_number_policy?: string | null;
    }>;
    InsurancePolicy?: { policy_number: string | null; currency?: string | null } | null;
    customer_number_policy?: string | null;
}): {
    policy_number: string | null;
    currency: string | null;
    customer_number_policy: string | null;
} {
    const active = customer.CustomerPolicy?.[0];
    const ip = customer.InsurancePolicy ?? active?.InsurancePolicy ?? null;
    return {
        policy_number: ip?.policy_number ?? null,
        currency: ip?.currency ?? null,
        customer_number_policy:
            active?.customer_number_policy ??
            customer.customer_number_policy ??
            null,
    };
}

/** Prefer invoice.policy_id policy for report rows; fall back to active customer policy. */
export function policyDisplayFromInvoiceRow(
    invoice: {
        InsurancePolicy?: {
            policy_number: string | null;
            currency?: string | null;
        } | null;
    },
    customer: Parameters<typeof policyDisplayFromCustomerRow>[0]
): ReturnType<typeof policyDisplayFromCustomerRow> {
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

/** Text search on the policy linked on the invoice (matches policy filter scope). */
export function invoiceLinkedPolicyTextSearchOr(
    t: string
): Prisma.InvoiceWhereInput {
    return {
        InsurancePolicy: {
            is: {
                policy_number: { contains: t, mode: "insensitive" },
            },
        },
    };
}
