/**
 * Shared AR post-ingest orchestrator for connector sync and file import.
 * Order when flags are on: chronological replay → deferred-payment maturity →
 * Process Overdue Invoices (touched customers, all accounts) →
 * live MEP/capacity-gap refresh → as-of rewrite enqueue.
 *
 * Credit steps (replay, maturity, live refresh, in-orchestrator as-of) are
 * credit-insurance-gated. Process Overdue runs for every account when enabled.
 * Collection-only accounts still return skipped so callers can enqueue as-of.
 *
 * Best-effort: step/customer failures are logged and collected; this function
 * does not throw for those failures so ingest can still succeed.
 */
import { type MaturityResult } from "@archaser/billing-connector";
import { type ReplayCustomerSummary } from "./importArReplayService";
export type ArPostIngestStep = "replay" | "maturity" | "process_overdue" | "live_refresh" | "as_of_enqueue";
export type ArPostIngestError = {
    step: ArPostIngestStep;
    customerId?: number;
    message: string;
    /** Kept so swallowed failures stay diagnosable after the run. */
    stack?: string;
};
export type RunArPostIngestOptions = {
    accountId: number;
    customerIds: number[];
    /** Chronological AR replay (stamp assessed limits). Default false. */
    runReplay?: boolean;
    /** Deferred-payment maturity pass for the account. Default false. */
    runMaturity?: boolean;
    /**
     * Process Overdue Invoices for touched customers (all accounts).
     * Default true so existing call sites pick up the step.
     */
    runProcessOverdue?: boolean;
    /** Live MEP + capacity-gap refresh. Default false. */
    runLiveRefresh?: boolean;
    /** Enqueue as-of rewrite for past snapshot days. Default false. */
    enqueueAsOfRewrite?: boolean;
    /** Preview / dry-run: skip all side effects including overdue. Default false. */
    dryRun?: boolean;
    /** Calendar as-of for maturity (defaults to now). */
    maturityAsOf?: Date;
    /**
     * Calendar as-of for the live refresh (MEP block, DCL, gap pipeline).
     * Omitted for normal imports so live columns reflect today; set it only when
     * replaying a historical day.
     */
    liveRefreshAsOf?: Date;
    /** Required when enqueueAsOfRewrite is true. */
    asOfRewrite?: {
        importType: "Invoice" | "Payment";
        entityIds: number[];
    };
    /**
     * Per-customer progress for callers that show a live bar. `total` counts
     * every customer-step this run will perform, so it stays accurate whether
     * one credit step is enabled or all three.
     */
    onProgress?: (progress: {
        completed: number;
        total: number;
    }) => void;
};
export type ArPostIngestResult = {
    skipped: boolean;
    skipReason?: "no_credit_insurance" | "dry_run";
    errors: ArPostIngestError[];
};
export type ArPostIngestDeps = {
    accountHasCreditInsurance: (accountId: number) => Promise<boolean>;
    replayCustomer: (args: {
        customerId: number;
        accountId: number;
    }) => Promise<ReplayCustomerSummary | void>;
    applyMaturity: (accountId: number, asOf: Date) => Promise<MaturityResult | void>;
    /** Full Process Overdue Invoices for one customer (daily-cron behavior). */
    processOverdueCustomer: (customerId: number) => Promise<void>;
    /** One customer at a time — same follow-up as triggerPostImportOverdueMetrics. */
    liveRefreshCustomer: (customerId: number, asOf?: Date) => Promise<void>;
    enqueueAsOfRewrite: (args: {
        accountId: number;
        importType: "Invoice" | "Payment";
        entityIds: number[];
        customerIds: number[];
    }) => Promise<void>;
    logError?: (message: string, meta?: Record<string, unknown>) => void;
};
export declare function defaultAccountHasCreditInsurance(accountId: number): Promise<boolean>;
export declare function createDefaultArPostIngestDeps(): ArPostIngestDeps;
/**
 * Run post-ingest AR refresh for affected customers.
 * Process Overdue runs for every account; replay / maturity / live refresh
 * (and in-orchestrator as-of) remain credit-insurance-gated.
 * Customers are processed one at a time for replay, overdue, and live refresh.
 */
export declare function runArPostIngestForCustomers(options: RunArPostIngestOptions, deps?: ArPostIngestDeps): Promise<ArPostIngestResult>;
