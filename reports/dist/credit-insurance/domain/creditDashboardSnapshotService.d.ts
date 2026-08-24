export type CreditDashboardSummaryHistoryScope = {
    isAdmin: boolean;
    selectedBusinessUnitId: number | null;
    /** Null for admin; empty when user has no accessible business units. */
    accessibleBusinessUnitIds: number[] | null;
};
export type CreditDashboardHistoryPoint = {
    snapshotDate: string;
    totalReceivables: number;
    compliantExposure: number;
    atRiskExposure: number;
    healthIndex: number;
    overdueBlockCustomerCount: number;
    capacityGapTotalAmount: number;
    termsBreachTotalAmount: number;
    withoutPolicyTotalAmount: number;
    reportingCountdownInvoiceCount: number;
    limitWarningsCustomerCount: number;
};
export type CreditDashboardHistoryDelta = {
    totalReceivables: number | null;
    compliantExposure: number | null;
    atRiskExposure: number | null;
    healthIndex: number | null;
};
export type CreditDashboardMonthPct = {
    totalReceivables: number | null;
    compliantExposure: number | null;
    atRiskExposure: number | null;
    overdueBlockCustomerCount: number | null;
    capacityGapTotalAmount: number | null;
    termsBreachTotalAmount: number | null;
    withoutPolicyTotalAmount: number | null;
    reportingCountdownInvoiceCount: number | null;
    limitWarningsCustomerCount: number | null;
};
export type CreditDashboardHistoryInterval = "daily" | "weekly";
export type CreditDashboardSummaryHistory = {
    series: CreditDashboardHistoryPoint[];
    delta: CreditDashboardHistoryDelta;
    monthPct: CreditDashboardMonthPct;
    interval: CreditDashboardHistoryInterval;
};
/**
 * Full cron mirror for one credit-insurance account: account-wide and per-policy
 * scopes, each repeated for null BU and every active business unit.
 */
export declare function takeCreditDashboardDailySnapshotsForAccount(accountId: number, options?: {
    snapshotDate?: Date;
    /** When set (e.g. shared backfill load), skip a second ledger query. */
    asOfLines?: import("./asOfOpenAr").AsOfOpenInvoiceLine[];
    /** Generate-job only: treat reporting-late as off in this snapshot. */
    ignoreReportingBreach?: boolean;
}): Promise<{
    scopesProcessed: number;
}>;
export declare function takeCreditDashboardDailySnapshots(): Promise<{
    scopesProcessed: number;
}>;
export declare function computeCreditDashboardHealthIndex(compliantExposure: number, totalReceivables: number): number;
export declare function aggregateCreditDashboardSnapshotRowsByDate(rows: CreditDashboardHistoryPoint[]): CreditDashboardHistoryPoint[];
export declare function getCreditDashboardSummaryHistory(accountId: number, days: number, policyId: number | undefined, interval: CreditDashboardHistoryInterval | undefined, scope: CreditDashboardSummaryHistoryScope): Promise<CreditDashboardSummaryHistory>;
