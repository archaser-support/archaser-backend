import { Prisma } from "@prisma/client";
import { type TopUpDashboardBlock, type TopUpExpiringSoonAlert } from "./creditInsuranceTopUpDashboardService";
import { type PolicyLimitUsageCategoryTotals } from "./portfolioPolicyLimitUsage";
export declare function sumCustomerPolicyInvoiceCapacityGap(accountId: number, customerId: number, policyId: number): Promise<{
    total: number | null;
    hasMissingSnapshots: boolean;
}>;
declare const TERMS_BREACH_REASON_FILTERS: readonly ["reporting_breach", "ctv_payment_term", "ctv_customer_overdue_mep", "ctv_outdated_dcl", "ctv_invoice_after_policy_end"];
export type TermsBreachReasonFilter = (typeof TERMS_BREACH_REASON_FILTERS)[number];
export declare function isTermsBreachReasonFilter(value: string): value is TermsBreachReasonFilter;
export type CreditReportListOptions = {
    query?: string;
    sortField?: string;
    sortDirection?: "asc" | "desc";
    policyId?: number;
    customerId?: number;
    termsBreachReason?: TermsBreachReasonFilter;
    termsOverdueOnly?: boolean;
    withinDays?: number;
    businessUnitFilter?: Prisma.CustomerWhereInput;
    includeNoPolicyExposure?: boolean;
};
export declare const invoiceTermsBreachWhere: (accountId: number) => Prisma.InvoiceWhereInput;
export declare function getCustomerTermsBreachOutstandingSum(accountId: number, customerId: number, options?: {
    excludeCapacityGapInvoices?: boolean;
    policyId?: number;
}): Promise<number>;
export declare function getCustomerTermsBreachOutstandingForAtRisk(accountId: number, customerId: number, options?: {
    policyId?: number;
}): Promise<number>;
export type CustomerBreachInvoiceCounts = {
    reportingBreachInvoiceCount: number;
    overdueBlockInvoiceCount: number;
};
export declare function getCustomerBreachInvoiceCounts(accountId: number, customerId: number, options?: {
    policyId?: number;
}): Promise<CustomerBreachInvoiceCounts>;
export declare function getCustomerTermsBreachOutstandingSumByCurrency(accountId: number, customerId: number, currency: string, options?: {
    excludeCapacityGapInvoices?: boolean;
    policyId?: number;
}): Promise<number>;
export declare function getCustomerTermsBreachOutstandingByCurrencyForAtRisk(accountId: number, customerId: number, currency: string, options?: {
    policyId?: number;
}): Promise<number>;
export declare function fetchOpenReceivableByCustomerMap(accountId: number, policyId?: number): Promise<Map<number, number>>;
export { fetchOpenReceivableForCustomerByCurrency } from "./openReceivableByCustomerCurrency";
export declare function fetchOpenReceivableForCustomer(accountId: number, customerId: number, policyId?: number | null): Promise<number>;
export declare function resolveOpenArOnPolicyInLimitCurrency(accountId: number, customerId: number, policyId: number, limitCurrency: string, accountCurrency: string | null): Promise<number>;
export type TermsBreachCountByReason = {
    reportingBreach: number;
    paymentTerm: number;
    customerOverdueMep: number;
    outdatedDcl: number;
    invoiceAfterPolicyEnd: number;
};
export type CreditDashboardSummary = {
    healthIndex: number;
    totalReceivables: number;
    compliantExposure: number;
    atRiskExposure: number;
    policyRiskExposure: number;
    policyRiskExposureCustomerCount: number;
    grossRiskExposure: number;
    overdueBlockCustomerCount: number;
    overdueBlockTotalOutstanding: number;
    capacityGap: {
        totalAmount: number;
        customerOverLimitCount: number;
    };
    termsBreach: {
        invoiceCount: number;
        totalAmount: number;
        countByReason: TermsBreachCountByReason;
    };
    withoutPolicy: {
        customerCount: number;
        totalAmount: number;
    };
    reportingCountdown: {
        invoiceCount: number;
        totalAmount: number;
        windowDays: number;
    };
    limitWarnings: {
        customerCount: number;
        totalAmount: number;
        thresholdPct: number;
        scoreWarnDays: number;
    };
    zeroLimitWarnings: {
        customerCount: number;
    };
    accountCurrency: string;
    hasTopUpPolicies: boolean;
    topUp: TopUpDashboardBlock | null;
    policyUsage: {
        combined: PolicyLimitUsageCategoryTotals;
        named: PolicyLimitUsageCategoryTotals;
        dclSdl: PolicyLimitUsageCategoryTotals;
        topUpCoverTotal: number;
        topUpCoverUsed: number;
        topUpCoverRemaining: number;
        topUpCoverOverEffective: number;
    };
    policyMaxCoverAlerts: Array<{
        policyId: number;
        policyNumber: string | null;
        totalAr: number;
        maxCover: number;
        exceededAmount: number;
    }>;
    policyExpirationAlerts: Array<{
        policyId: number;
        policyNumber: string | null;
        endDate: string;
    }>;
    topUpExpirationAlerts: TopUpExpiringSoonAlert[];
};
export declare function getAccountDisplayCurrency(accountId: number): Promise<string>;
export declare function convertApprovedLimitToAccountCurrency(amount: number | null | undefined, limitCurrency: string | null | undefined, accountCurrency: string, options?: {
    accountId?: number;
    customerId?: number;
    policyId?: number;
}): Promise<number | null>;
export declare function getCreditDashboardSummary(accountId: number, policyId?: number, businessUnitFilter?: Prisma.CustomerWhereInput, includeNoPolicyExposure?: boolean): Promise<CreditDashboardSummary>;
export type OverdueBlockRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    outstandingAmount: number;
    maxDaysOverdue: number;
    openInvoices: number;
    currency: string;
};
export declare function getOverdueBlockReport(accountId: number, take: number, skip: number, options?: CreditReportListOptions): Promise<{
    total: number;
    rows: OverdueBlockRow[];
}>;
export type CapacityGapRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    approvedLimit: number | null;
    approvedLimitCurrency: string | null;
    limitType: string | null;
    totalAR: number;
    openInvoices: number;
    uninsuredGap: number;
    currency: string;
};
export declare function getCustomerCapacityGapForReport(accountId: number, customerId: number, policyId?: number): Promise<{
    amount: number;
    amountSecondary: number | null;
}>;
export declare function getCapacityGapReport(accountId: number, take: number, skip: number, options?: CreditReportListOptions): Promise<{
    total: number;
    rows: CapacityGapRow[];
}>;
export type PolicyRiskExposureReportRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    openAR: number;
    capacityGap: number;
    termsBreachOutstanding: number;
    policyRiskAllocated: number;
    currency: string;
};
export type NoPolicyExposureReportRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    customerNumber: string | null;
    openAR: number;
    exclusionReason: string | null;
    currency: string;
};
export declare function getPolicyRiskExposureReport(accountId: number, take: number, skip: number, options?: CreditReportListOptions): Promise<{
    total: number;
    rows: PolicyRiskExposureReportRow[];
}>;
export declare function getNoPolicyExposureReport(accountId: number, take: number, skip: number, options?: CreditReportListOptions): Promise<{
    total: number;
    rows: NoPolicyExposureReportRow[];
}>;
export type TermsBreachRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    invoiceId: number;
    invoiceNumber: string | null;
    termsBreachReasonCodes: string[];
    invoiceAmount: number;
    invoiceAmountAccount: number;
    currency: string;
};
export declare function getTermsBreachReport(accountId: number, take: number, skip: number, options?: CreditReportListOptions): Promise<{
    total: number;
    rows: TermsBreachRow[];
}>;
export type ReportingCountdownRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    invoiceId: number;
    invoiceNumber: string | null;
    invoiceAmount: number;
    currency: string;
    daysOverdue: number;
    daysLeftForReporting: number;
};
export declare function getReportingCountdownOpenReport(accountId: number, take: number, skip: number, windowDays: number, options?: CreditReportListOptions): Promise<{
    total: number;
    rows: ReportingCountdownRow[];
}>;
export type ReportedInvoicesRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    invoiceId: number;
    invoiceNumber: string | null;
    invoiceAmount: number;
    currency: string;
    actualReportingDate: string | null;
    reportingCapturedAt: string | null;
    reportingRefComment: string | null;
};
export declare function getReportedInvoicesReport(accountId: number, take: number, skip: number, options?: CreditReportListOptions): Promise<{
    total: number;
    rows: ReportedInvoicesRow[];
}>;
export type LimitWarningRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    nearLimit: boolean;
    nearLimitUtilizationPct: number | null;
    scoreExpiring: boolean;
    scoreExpiresInDays: number | null;
    creditScoreInputDate: string | null;
    approvedLimit: number | null;
    limitType: string | null;
    totalAR: number;
    currency: string;
    limitExpiring: boolean;
    limitExpiresInDays: number | null;
    approvedLimitExpirationDate: string | null;
};
export declare function getLimitWarningReport(accountId: number, take: number, skip: number, options?: CreditReportListOptions): Promise<{
    total: number;
    rows: LimitWarningRow[];
}>;
export type ZeroLimitWarningRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    zeroLimitDate: string | null;
    totalAR: number;
    openInvoices: number;
    currency: string;
};
export declare function getZeroLimitWarningReport(accountId: number, take: number, skip: number, options?: CreditReportListOptions): Promise<{
    total: number;
    rows: ZeroLimitWarningRow[];
}>;
