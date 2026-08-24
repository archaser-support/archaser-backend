import { PrismaClient } from "@prisma/client";
type PrismaClientLike = PrismaClient;
export type CreditAsOfBackfillStatus = "idle" | "running" | "paused" | "failed" | "complete";
export type CreditAsOfBackfillJobView = {
    status: CreditAsOfBackfillStatus;
    fromDate: string | null;
    toDate: string | null;
    checkpointDate: string | null;
    daysTotal: number;
    daysDone: number;
    lastError: string | null;
    requestedBy: string | null;
    startedAt: string | null;
    updatedAt: string | null;
    skipReportingBreach: boolean;
};
export declare function countInclusiveUtcDays(fromDate: Date, toDate: Date): number;
export declare function enumerateUtcDaysInclusive(fromDate: Date, toDate: Date): Date[];
export declare function getCreditAsOfBackfillJobStatus(accountId: number, options?: {
    dbClient?: PrismaClientLike;
}): Promise<CreditAsOfBackfillJobView>;
export declare class CreditAsOfBackfillConflictError extends Error {
    constructor(message: string);
}
type AsOfLines = import("./asOfOpenAr").AsOfOpenInvoiceLine[];
type BackfillWriters = {
    syncCustomerPolicyTrendSnapshotForAccount: (accountId: number, options: {
        snapshotDate: Date;
        asOfLines?: AsOfLines;
        ignoreReportingBreach?: boolean;
    }) => Promise<unknown>;
    takeCreditDashboardDailySnapshotsForAccount: (accountId: number, options: {
        snapshotDate: Date;
        asOfLines?: AsOfLines;
        ignoreReportingBreach?: boolean;
    }) => Promise<unknown>;
};
type LoadAsOfLines = (accountId: number, asOfDate: Date) => Promise<AsOfLines>;
/**
 * Day-by-day as-of rewrite for one account. Checks pause between days.
 * Safe to call while status is already `running` (used after start/retry).
 */
export declare function runCreditAsOfBackfillJob(accountId: number, options?: {
    dbClient?: PrismaClientLike;
    writers?: Partial<BackfillWriters>;
    loadAsOfLines?: LoadAsOfLines;
    now?: Date;
}): Promise<CreditAsOfBackfillJobView>;
export declare function startCreditAsOfBackfillJob(accountId: number, fromDate: Date, toDate: Date, options?: {
    requestedBy?: string | null;
    skipReportingBreach?: boolean;
    dbClient?: PrismaClientLike;
    writers?: Partial<BackfillWriters>;
    loadAsOfLines?: LoadAsOfLines;
    runInline?: boolean;
}): Promise<CreditAsOfBackfillJobView>;
export declare function pauseCreditAsOfBackfillJob(accountId: number, options?: {
    dbClient?: PrismaClientLike;
}): Promise<CreditAsOfBackfillJobView>;
export declare function retryCreditAsOfBackfillJob(accountId: number, options?: {
    dbClient?: PrismaClientLike;
    writers?: Partial<BackfillWriters>;
    loadAsOfLines?: LoadAsOfLines;
    runInline?: boolean;
}): Promise<CreditAsOfBackfillJobView>;
/** Exported for tests — clear in-process runner guard. */
export declare function __resetCreditAsOfBackfillRunnersForTests(): void;
export {};
