import type { Prisma } from "@prisma/client";
import { record_status } from "@prisma/client";
/** Live collection customers (credit dashboard scope). */
export declare const COLLECTION_LIVE: record_status[];
/** Customer filter: active CustomerPolicy links to the given insurance policy. */
export declare function customerActivePolicyFilter(policyId: number): Prisma.CustomerWhereInput;
export declare function customersScopedByActivePolicy(accountId: number, policyId?: number): Prisma.CustomerWhereInput;
/** Live customers with an active CustomerPolicy row (any insurance policy). */
export declare function customersWithActiveCustomerPolicyFilter(): Prisma.CustomerWhereInput;
/**
 * Credit dashboard customer scope: policy filter uses invoices + active policy;
 * portfolio ("All Policies") includes any live customer with open receivables
 * (Due/Overdue) or an active linked CustomerPolicy.
 */
export declare function customersScopedForCreditDashboard(accountId: number, policyId?: number): Prisma.CustomerWhereInput;
export declare function hasDashboardBusinessUnitScope(businessUnitFilter?: Prisma.CustomerWhereInput): boolean;
/** AND dashboard BU resolver output onto credit dashboard customer scope. */
export declare function mergeDashboardBusinessUnitIntoCustomerScope(customerScope: Prisma.CustomerWhereInput, businessUnitFilter?: Prisma.CustomerWhereInput): Prisma.CustomerWhereInput;
export declare function customersScopedForCreditDashboardWithBusinessUnit(accountId: number, policyId?: number, businessUnitFilter?: Prisma.CustomerWhereInput): Prisma.CustomerWhereInput;
export declare function applyBusinessUnitFilterToInvoiceWhere(where: Prisma.InvoiceWhereInput, businessUnitFilter?: Prisma.CustomerWhereInput): Prisma.InvoiceWhereInput;
/**
 * Policy-scoped customer list: active CustomerPolicy on the policy OR open invoices tagged with policy_id.
 */
export declare function customersScopedByPolicyInvoicesOrActive(accountId: number, policyId: number): Prisma.CustomerWhereInput;
export declare function withInvoiceCustomerPolicyFilter(where: Prisma.InvoiceWhereInput, policyId?: number): Prisma.InvoiceWhereInput;
/** Policies with at least one live customer on active CustomerPolicy. */
export declare function insurancePolicyAssignedToLiveCustomersFilter(accountId: number): Prisma.InsurancePolicyWhereInput;
/** Text search on customer number, name, and active policy fields. */
export declare function customerPolicyTextSearchOr(t: string): Prisma.CustomerWhereInput[];
/** Active CustomerPolicy + InsurancePolicy for nested Customer selects. */
export declare const ACTIVE_CUSTOMER_POLICY_NESTED_SELECT: {
    readonly where: {
        readonly is_active: true;
    };
    readonly take: 1;
    readonly select: {
        readonly customer_number_policy: true;
        readonly approved_limit: true;
        readonly approved_limit_currency: true;
        readonly limit_type: true;
        readonly outdated_dcl: true;
        readonly insurance_policy_id: true;
        readonly InsurancePolicy: {
            readonly select: {
                readonly policy_number: true;
                readonly currency: true;
            };
        };
    };
};
export declare function policyDisplayFromCustomerRow(customer: {
    CustomerPolicy?: Array<{
        InsurancePolicy?: {
            policy_number: string | null;
            currency?: string | null;
        } | null;
        customer_number_policy?: string | null;
    }>;
    InsurancePolicy?: {
        policy_number: string | null;
        currency?: string | null;
    } | null;
    customer_number_policy?: string | null;
}): {
    policy_number: string | null;
    currency: string | null;
    customer_number_policy: string | null;
};
/** Prefer invoice.policy_id policy for report rows; fall back to active customer policy. */
export declare function policyDisplayFromInvoiceRow(invoice: {
    InsurancePolicy?: {
        policy_number: string | null;
        currency?: string | null;
    } | null;
}, customer: Parameters<typeof policyDisplayFromCustomerRow>[0]): ReturnType<typeof policyDisplayFromCustomerRow>;
/** Text search on the policy linked on the invoice (matches policy filter scope). */
export declare function invoiceLinkedPolicyTextSearchOr(t: string): Prisma.InvoiceWhereInput;
