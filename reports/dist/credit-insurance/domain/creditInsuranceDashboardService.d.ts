import { Prisma } from "@prisma/client";
import { type TopUpDashboardBlock, type TopUpExpiringSoonAlert } from "./creditInsuranceTopUpDashboardService";
import { type PolicyLimitUsageCategoryTotals } from "./portfolioPolicyLimitUsage";
/** Invoice-summed capacity gap for one customer policy (null → use stored policy fallback). */
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
    /** When set, restrict rows to customers linked to this policy (must belong to the account). */
    policyId?: number;
    /** When set, restrict invoice reports to this customer (must belong to the account). */
    customerId?: number;
    /** Terms report only: single breach flag (matches `termsBreachReasonCodes` on rows). */
    termsBreachReason?: TermsBreachReasonFilter;
    /** Terms report only: Overdue invoices only (e.g. customer dashboard reporting breach KPI). */
    termsOverdueOnly?: boolean;
    /** Top-up expiring report: window in days (default 30). */
    withinDays?: number;
    /** Dashboard business-unit filter from {@link resolveDashboardBusinessUnitFilter}. */
    businessUnitFilter?: Prisma.CustomerWhereInput;
    /** Dashboard/report cohort toggle: include no-policy exposure cohort when true. */
    includeNoPolicyExposure?: boolean;
};
/**
 * Invoices in terms breach: Due/Overdue with any breach flag or reporting_breach.
 */
export declare const invoiceTermsBreachWhere: (accountId: number) => Prisma.InvoiceWhereInput;
/**
 * Sum of line outstanding for this customer's invoices in due/overdue terms breach
 * (same breach flags as the credit dashboard terms report).
 *
 * When {@link excludeCapacityGapInvoices} is true, each breached invoice contributes
 * outstanding minus its capacity gap so at-risk does not double-count.
 */
export declare function getCustomerTermsBreachOutstandingSum(accountId: number, customerId: number, options?: {
    excludeCapacityGapInvoices?: boolean;
    /** When set, only Due/Overdue invoices tagged with this insurance policy. */
    policyId?: number;
}): Promise<number>;
/** Terms-breach outstanding for at-risk (net of invoice capacity gap). */
export declare function getCustomerTermsBreachOutstandingForAtRisk(accountId: number, customerId: number, options?: {
    policyId?: number;
}): Promise<number>;
export type CustomerBreachInvoiceCounts = {
    reportingBreachInvoiceCount: number;
    overdueBlockInvoiceCount: number;
};
/** Open invoice counts for customer dashboard breach cards. */
export declare function getCustomerBreachInvoiceCounts(accountId: number, customerId: number, options?: {
    policyId?: number;
}): Promise<CustomerBreachInvoiceCounts>;
/**
 * Terms-breach outstanding in a specific invoice/customer currency (e.g. GBP),
 * derived from invoice-side customer amounts, not FX conversion.
 */
export declare function getCustomerTermsBreachOutstandingSumByCurrency(accountId: number, customerId: number, currency: string, options?: {
    excludeCapacityGapInvoices?: boolean;
    policyId?: number;
}): Promise<number>;
/** Terms-breach outstanding in invoice currency for at-risk (net of invoice capacity gap). */
export declare function getCustomerTermsBreachOutstandingByCurrencyForAtRisk(accountId: number, customerId: number, currency: string, options?: {
    policyId?: number;
}): Promise<number>;
/**
 * Open Due/Overdue receivable per customer (same line-outstanding rule as dashboard terms SQL).
 * Prefer this over {@link totalArFromCustomerRow} for portfolio KPIs when customer denormalized
 * totals may lag invoice balances.
 */
export declare function fetchOpenReceivableByCustomerMap(accountId: number, policyId?: number): Promise<Map<number, number>>;
export { fetchOpenReceivableForCustomerByCurrency } from "./openReceivableByCustomerCurrency";
/**
 * Open Due/Overdue receivable for one customer (same rule as {@link fetchOpenReceivableByCustomerMap} /
 * capacity-gap cron). Use for credit-insurance header when denormalized customer AR may disagree with invoices.
 */
export declare function fetchOpenReceivableForCustomer(accountId: number, customerId: number, policyId?: number | null): Promise<number>;
/**
 * Open AR on a policy in the same currency as {@link CustomerPolicy.approved_limit}.
 * When limit currency matches account currency, uses account-currency invoice totals
 * (`outstanding_debt`). Otherwise sums invoice lines in the limit currency.
 */
export declare function resolveOpenArOnPolicyInLimitCurrency(accountId: number, customerId: number, policyId: number, limitCurrency: string, accountCurrency: string | null): Promise<number>;
/** Invoice counts per breach flag (one invoice may contribute to multiple categories). */
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
    /**
     * Sum of per-customer compliant remainder: open AR minus allocated at-risk
     * (see atRiskExposure). Equals totalReceivables − atRiskExposure.
     */
    compliantExposure: number;
    /**
     * Sum of per-customer allocated at-risk: no-policy customers → full AR;
     * with policy → min(AR, capacity gap + terms breach outstanding);
     * plus portfolio limit residual: max(0, Σ policy max(0, policy AR − max cover) − capacity gap total).
     */
    atRiskExposure: number;
    /**
     * Sum of min(AR, gap + terms breach) for customers with a linked policy only.
     * Equals atRiskExposure minus withoutPolicy.totalAmount.
     */
    policyRiskExposure: number;
    /**
     * Insured customers in scope with open AR > 0 (same rows that feed {@link CreditDashboardSummary.policyRiskExposure}).
     */
    policyRiskExposureCustomerCount: number;
    /**
     * Uncapped driver sum: no-policy → full AR; with policy → capacity gap +
     * terms breach net of invoice capacity gap (before min with AR).
     */
    grossRiskExposure: number;
    overdueBlockCustomerCount: number;
    /** Sum of customer total AR (due + overdue) for customers in overdue block. */
    overdueBlockTotalOutstanding: number;
    capacityGap: {
        totalAmount: number;
        customerOverLimitCount: number;
    };
    termsBreach: {
        invoiceCount: number;
        totalAmount: number;
        /** Invoices per breach flag (counts may overlap across categories). */
        countByReason: TermsBreachCountByReason;
    };
    /** Customers with no linked policy: count and total open AR (treated as uninsured in at-risk logic). */
    withoutPolicy: {
        customerCount: number;
        totalAmount: number;
    };
    /** Invoices to report: open, not in breach, target within the next N days. */
    reportingCountdown: {
        invoiceCount: number;
        totalAmount: number;
        windowDays: number;
    };
    /** Unique customers: near limit (below 100% AR) and/or credit score expiring in window. */
    limitWarnings: {
        customerCount: number;
        totalAmount: number;
        thresholdPct: number;
        scoreWarnDays: number;
    };
    zeroLimitWarnings: {
        customerCount: number;
    };
    /** Account default currency for display (ISO code). */
    accountCurrency: string;
    hasTopUpPolicies: boolean;
    topUp: TopUpDashboardBlock | null;
    /**
     * Portfolio policy-limits usage: customer approved-limit categories
     * (combined / Named / DCL/SDL), not insurer policy max-cover caps.
     */
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
/** Approved limit converted to account display currency for portfolio reports. */
export declare function convertApprovedLimitToAccountCurrency(amount: number | null | undefined, limitCurrency: string | null | undefined, accountCurrency: string, options?: {
    accountId?: number;
    customerId?: number;
    policyId?: number;
}): Promise<number | null>;
export declare function getCreditDashboardSummary(accountId: number, policyId?: number, businessUnitFilter?: Prisma.CustomerWhereInput, includeNoPolicyExposure?: boolean, options?: {
    asOfDate?: Date;
    /** Preloaded payment-ledger rows for `asOfDate` (avoids N SQL loads per scope). */
    asOfLines?: import("./asOfOpenAr").AsOfOpenInvoiceLine[];
}): Promise<CreditDashboardSummary>;
export type OverdueBlockRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    outstandingAmount: number;
    maxDaysOverdue: number;
    openInvoices: number;
    /** Customer-first resolved ISO currency for the row (display). */
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
/** Same capacity-gap basis as the credit dashboard capacity report table. */
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
    /** min(open AR, capacity gap + terms breach outstanding) — same as dashboard policy risk per row. */
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
/**
 * Insured customers only: open AR, capacity gap, terms-breach outstanding, and allocated policy risk
 * (same rules as credit dashboard {@link CreditDashboardSummary.policyRiskExposure}).
 */
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
    /** Same line in account base currency (FX when invoice currency differs). */
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
    /** Single DB field: reference / comment */
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
