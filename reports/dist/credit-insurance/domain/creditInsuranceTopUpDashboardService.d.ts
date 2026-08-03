import { Prisma } from "@prisma/client";
export type TopUpDashboardBlock = {
    activeCoverTotal: number;
    customersWithActiveCount: number;
    expiringWithinDays: {
        customerCount: number;
        totalAmount: number;
        windowDays: number;
        urgentCustomerCount: number;
    };
    incrementalCoverTotal: number;
    coverDeclinedDueToLimit: {
        customerCount: number;
        coverLostTotal: number;
    };
};
export type TopUpPolicyUsageMetrics = {
    topUpCoverTotal: number;
    topUpCoverUsed: number;
    topUpCoverRemaining: number;
    topUpCoverOverEffective: number;
};
export type TopUpExpiringSoonAlert = {
    customerId: number;
    customerName: string | null;
    policyId: number;
    policyNumber: string | null;
    endDate: string;
};
type CustomerRow = {
    id: number;
    policy_id: number | null;
    approved_limit?: Prisma.Decimal | null;
    approved_limit_currency?: string | null;
    outdated_dcl?: boolean | null;
    excluded_from_policy?: boolean;
};
export declare function computeTopUpDashboardMetrics(args: {
    accountId: number;
    accountCurrency: string;
    expiringWindowDays: number;
    primaryPolicyId?: number;
    customers: CustomerRow[];
    openArByCustomerId: Map<number, number>;
}): Promise<{
    topUp: TopUpDashboardBlock;
    policyUsageTopUp: TopUpPolicyUsageMetrics;
    expiringSoonAlerts: TopUpExpiringSoonAlert[];
}>;
export declare function getTopUpExpiringSoonAlerts(accountId: number, withinDays: number, primaryPolicyId?: number, businessUnitFilter?: import("@prisma/client").Prisma.CustomerWhereInput): Promise<TopUpExpiringSoonAlert[]>;
export type CustomerTopUpEnrichFields = {
    has_top_up_policies: boolean;
    active_top_up_count: number;
    top_up_total: number | null;
    effective_approved_limit: number | null;
    base_approved_limit: number | null;
    has_active_top_up: boolean;
    top_up_expires_soonest: string | null;
    has_scheduled_top_up: boolean;
};
export declare function enrichCustomerTopUpFields(customerId: number, accountId: number, policyFields: {
    approved_limit?: Prisma.Decimal | null;
    approved_limit_currency?: string | null;
    outdated_dcl?: boolean | null;
    excluded_from_policy?: boolean;
}): Promise<CustomerTopUpEnrichFields>;
export type TopUpCoverReportRow = {
    customerId: number;
    customerName: string;
    policyNumber: string | null;
    baseApprovedLimit: number | null;
    topUpTotal: number;
    effectiveLimit: number | null;
    totalAR: number;
    currency: string;
};
export type TopUpExpiringReportRow = {
    customerId: number;
    customerName: string;
    policyNumber: string | null;
    topUpType: "Fixed" | "Percentage";
    topUpValue: number;
    resolvedAmount: number;
    endDate: string;
    daysLeft: number;
    currency: string;
};
export declare function getTopUpCoverReport(accountId: number, take: number, skip: number, options?: {
    query?: string;
    sortField?: string;
    sortDirection?: "asc" | "desc";
    policyId?: number;
    customerId?: number;
    businessUnitFilter?: import("@prisma/client").Prisma.CustomerWhereInput;
}): Promise<{
    total: number;
    rows: TopUpCoverReportRow[];
}>;
export declare function getTopUpExpiringReport(accountId: number, take: number, skip: number, options?: {
    query?: string;
    sortField?: string;
    sortDirection?: "asc" | "desc";
    policyId?: number;
    customerId?: number;
    withinDays?: number;
    businessUnitFilter?: import("@prisma/client").Prisma.CustomerWhereInput;
}): Promise<{
    total: number;
    rows: TopUpExpiringReportRow[];
}>;
export {};
