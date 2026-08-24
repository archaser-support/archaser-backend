import { type DbClient } from "../domain-db";
/** Invoice statuses excluded from as-of open AR (cancelled / void book). */
export declare const ASOF_OPEN_AR_EXCLUDED_STATUSES: readonly ["Void", "Cancelled"];
export type AsOfAmountPair = {
    /** Primary / account-side amount (invoice `amount`, payment `amount`). */
    amount: number | null | undefined;
    /** Customer-currency amount (`customer_amount`). */
    customerAmount: number | null | undefined;
};
/**
 * Prefer primary amount when non-zero, else customer amount — same COALESCE
 * spirit as live open-AR line outstanding.
 */
export declare function preferAmountPair(pair: AsOfAmountPair): number;
/**
 * Payment-ledger open amount as of day D: max(0, original − payments on/before D).
 */
export declare function computeAsOfOpenAmount(original: number, paymentsOnOrBeforeAsOf: number): number;
export type AsOfOpenStatus = "Due" | "Overdue";
/**
 * Classify remaining open balance vs due date on as-of day D (UTC calendar).
 */
export declare function classifyAsOfOpenStatus(dueDate: Date | null | undefined, asOfDate: Date): AsOfOpenStatus;
export declare function toUtcDayStart(date: Date): Date;
/** Exclusive upper bound: first UTC instant after as-of calendar day. */
export declare function utcDayAfterExclusive(asOfDate: Date): Date;
export type AsOfOpenInvoiceLine = {
    invoiceId: number;
    customerId: number;
    policyId: number | null;
    invoiceDate: Date;
    dueDate: Date | null;
    amount: number | null;
    customerAmount: number | null;
    customerCurrency: string | null;
    paymentsOnOrBeforeAsOf: number;
    paymentsCustomerOnOrBeforeAsOf: number;
    /** Latest payment on/before the snapshot load day; used to reconstruct open-at-creation. */
    lastPaymentDate?: Date | null;
    reportingBreach: boolean;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl: boolean;
    ctvInvoiceAfterPolicyEnd: boolean;
    inCapacityGap: boolean;
    capacityGapAmount?: number;
    actualReportingDate?: Date | null;
};
/** Policy terms used to recompute invoice breach flags as of a snapshot day. */
export type AsOfPolicyTermsForBreach = {
    maxPaymentTerm: number | null;
    maxAllowedMep: number | null;
    reportingDays: number | null;
    mepCutoffDayOfMonth?: number | null;
    mepSubstituteDayOfMonth?: number | null;
    reportingCutoffDayOfMonth?: number | null;
    reportingSubstituteDayOfMonth?: number | null;
    paymentTermCutoffDayOfMonth?: number | null;
    paymentTermSubstituteDayOfMonth?: number | null;
    policyEndDate?: Date | null;
};
/**
 * Over-limit slice as of the snapshot day. Outdated DCL suppresses the gap
 * (same rule as live capacity-gap computation).
 */
export declare function asOfCapacityGapAmount(totalReceivables: number, effectiveApprovedLimit: number | null | undefined, outdatedDcl: boolean): number;
/**
 * Whether `line` still had open AR on calendar day `atDate`.
 * Snapshot payment totals are as-of the load day; lastPaymentDate reconstructs
 * invoices that were later paid.
 */
export declare function wasAsOfInvoiceOpenAt(line: AsOfOpenInvoiceLine, atDate: Date): boolean;
/**
 * Customer overdue_block as of `atDate`: oldest overdue due among invoices
 * still open that day, plus max allowed MEP.
 */
export declare function asOfCustomerOverdueBlockAt(customerLines: AsOfOpenInvoiceLine[], atDate: Date, maxAllowedMep: number | null | undefined): boolean;
/**
 * Recompute terms-breach flags for an as-of-open invoice from policy terms and
 * the snapshot calendar day. MEP is created-in-violation: true when the
 * customer overdue block was already on at this invoice's issue date.
 */
export declare function overlayAsOfTermsFlagsOnLine(line: AsOfOpenInvoiceLine, asOfDate: Date, terms: AsOfPolicyTermsForBreach, options?: {
    siblingLines?: AsOfOpenInvoiceLine[];
    /** Snapshot math only — do not count reporting-late. Invoice rows stay unchanged. */
    ignoreReportingBreach?: boolean;
}): AsOfOpenInvoiceLine;
export declare function overlayAsOfTermsFlagsOnLines(lines: AsOfOpenInvoiceLine[], asOfDate: Date, termsByCustomerAndPolicy: Map<string, AsOfPolicyTermsForBreach>, options?: {
    ignoreReportingBreach?: boolean;
}): AsOfOpenInvoiceLine[];
/** Force reporting-late off on ledger lines (dashboard snapshot path). */
export declare function withReportingBreachIgnored(lines: AsOfOpenInvoiceLine[], ignoreReportingBreach: boolean): AsOfOpenInvoiceLine[];
export declare function asOfTermsScopeKey(customerId: number, policyId: number | null | undefined): string;
export type AsOfOpenInvoiceComputed = AsOfOpenInvoiceLine & {
    openAmount: number;
    openCustomerAmount: number;
    status: AsOfOpenStatus;
};
export declare function computeAsOfOpenInvoiceLine(line: AsOfOpenInvoiceLine, asOfDate: Date): AsOfOpenInvoiceComputed | null;
/**
 * Load invoice + payment-ledger rows that could be open as of `asOfDate`.
 * Callers filter to open &gt; 0 via {@link computeAsOfOpenInvoiceLine}.
 */
export declare function loadAsOfOpenInvoiceCandidates(accountId: number, asOfDate: Date, options?: {
    customerIds?: number[];
    policyId?: number;
    dbClient?: DbClient;
}): Promise<AsOfOpenInvoiceLine[]>;
/** Sum as-of open amount from a preloaded ledger (no DB). */
export declare function sumAsOfOpenAmountFromLines(lines: AsOfOpenInvoiceLine[], asOfDate: Date, options?: {
    customerId?: number;
    policyId?: number | null;
}): number;
export declare function sumAsOfOpenAmountByCurrencyFromLines(lines: AsOfOpenInvoiceLine[], asOfDate: Date, currency: string, options?: {
    customerId?: number;
    policyId?: number | null;
}): number;
export declare function resolveAsOfOpenArOnPolicyInLimitCurrencyFromLines(lines: AsOfOpenInvoiceLine[], customerId: number, policyId: number, limitCurrency: string, accountCurrency: string | null, asOfDate: Date): number;
export declare function sumAsOfTermsBreachFromLines(lines: AsOfOpenInvoiceLine[], asOfDate: Date, options?: {
    customerId?: number;
    policyId?: number | null;
    excludeCapacityGapInvoices?: boolean;
}): number;
export declare function buildAsOfOpenReceivableByCustomerMapFromLines(lines: AsOfOpenInvoiceLine[], asOfDate: Date): Map<number, number>;
/** Open as-of breach invoice rows for the existing by-reason aggregator. */
export declare function asOfTermsBreachInvoicesFromLines(lines: AsOfOpenInvoiceLine[], asOfDate: Date, customerId: number, policyId: number | null): Array<{
    policyId: number | null;
    outstanding: number;
    reportingBreach: boolean;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl: boolean;
    ctvInvoiceAfterPolicyEnd: boolean;
}>;
export declare function fetchAsOfOpenReceivableByCustomerMap(accountId: number, asOfDate: Date, options?: {
    customerIds?: number[];
    policyId?: number;
    dbClient?: DbClient;
}): Promise<Map<number, number>>;
/**
 * As-of open AR per customer in account currency (latest FX when needed).
 */
export declare function fetchAsOfOpenReceivableByCustomerMapInAccountCurrency(accountId: number, accountCurrency: string, asOfDate: Date, options?: {
    customerIds?: number[];
    policyId?: number;
    dbClient?: DbClient;
}): Promise<Map<number, number>>;
export declare function buildAsOfOpenReceivableByCustomerMapInAccountCurrencyFromLines(lines: AsOfOpenInvoiceLine[], accountCurrency: string, asOfDate: Date, options?: {
    customerIds?: number[];
    policyId?: number;
}): Promise<Map<number, number>>;
export declare function fetchAsOfOpenReceivableForCustomer(accountId: number, customerId: number, asOfDate: Date, policyId?: number | null, dbClient?: DbClient): Promise<number>;
export declare function fetchAsOfOpenReceivableForCustomerByCurrency(accountId: number, customerId: number, currency: string, asOfDate: Date, policyId?: number | null, dbClient?: DbClient): Promise<number>;
export declare function resolveAsOfOpenArOnPolicyInLimitCurrency(accountId: number, customerId: number, policyId: number, limitCurrency: string, accountCurrency: string | null, asOfDate: Date, dbClient?: DbClient): Promise<number>;
export declare function getCustomerAsOfTermsBreachOutstandingSum(accountId: number, customerId: number, asOfDate: Date, options?: {
    excludeCapacityGapInvoices?: boolean;
    policyId?: number;
    dbClient?: DbClient;
}): Promise<number>;
export declare function getCustomerAsOfTermsBreachOutstandingForAtRisk(accountId: number, customerId: number, asOfDate: Date, options?: {
    policyId?: number;
    dbClient?: DbClient;
}): Promise<number>;
/**
 * Terms-breach open outstanding per customer in account currency (as-of).
 */
export declare function fetchAsOfTermsBreachOutstandingByCustomerInAccountCurrency(accountId: number, accountCurrency: string, asOfDate: Date, options?: {
    policyId?: number;
    excludeCapacityGapInvoices?: boolean;
    customerIds?: number[];
    dbClient?: DbClient;
}): Promise<Map<number, number>>;
export declare function buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines(lines: AsOfOpenInvoiceLine[], accountCurrency: string, asOfDate: Date, options?: {
    policyId?: number;
    excludeCapacityGapInvoices?: boolean;
    customerIds?: number[];
}): Promise<Map<number, number>>;
