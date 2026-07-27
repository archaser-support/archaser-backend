import type { Prisma } from "@prisma/client";
import { record_status } from "@prisma/client";
export declare const COLLECTION_LIVE: record_status[];
export declare function customerActivePolicyFilter(policyId: number): Prisma.CustomerWhereInput;
export declare function customersScopedByActivePolicy(accountId: number, policyId?: number): Prisma.CustomerWhereInput;
export declare function customersWithActiveCustomerPolicyFilter(): Prisma.CustomerWhereInput;
export declare function customersScopedForCreditDashboard(accountId: number, policyId?: number): Prisma.CustomerWhereInput;
export declare function hasDashboardBusinessUnitScope(businessUnitFilter?: Prisma.CustomerWhereInput): boolean;
export declare function mergeDashboardBusinessUnitIntoCustomerScope(customerScope: Prisma.CustomerWhereInput, businessUnitFilter?: Prisma.CustomerWhereInput): Prisma.CustomerWhereInput;
export declare function customersScopedForCreditDashboardWithBusinessUnit(accountId: number, policyId?: number, businessUnitFilter?: Prisma.CustomerWhereInput): Prisma.CustomerWhereInput;
export declare function applyBusinessUnitFilterToInvoiceWhere(where: Prisma.InvoiceWhereInput, businessUnitFilter?: Prisma.CustomerWhereInput): Prisma.InvoiceWhereInput;
export declare function customersScopedByPolicyInvoicesOrActive(accountId: number, policyId: number): Prisma.CustomerWhereInput;
export declare function withInvoiceCustomerPolicyFilter(where: Prisma.InvoiceWhereInput, policyId?: number): Prisma.InvoiceWhereInput;
export declare function insurancePolicyAssignedToLiveCustomersFilter(accountId: number): Prisma.InsurancePolicyWhereInput;
export declare function customerPolicyTextSearchOr(t: string): Prisma.CustomerWhereInput[];
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
export declare function policyDisplayFromInvoiceRow(invoice: {
    InsurancePolicy?: {
        policy_number: string | null;
        currency?: string | null;
    } | null;
}, customer: Parameters<typeof policyDisplayFromCustomerRow>[0]): ReturnType<typeof policyDisplayFromCustomerRow>;
export declare function invoiceLinkedPolicyTextSearchOr(t: string): Prisma.InvoiceWhereInput;
