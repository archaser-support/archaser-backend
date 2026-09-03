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
import {
    applyMaturedDeferredPayments,
    type MaturityResult,
} from "@archaser/billing-connector";
import {
    creditInsurancePrisma as prisma,
    enqueueRewriteForImport,
    syncCustomerInsuranceFields,
} from "@archaser/credit-insurance-domain";

import { handleOverdueInvoices } from "../handleOverdueInvoices";
import {
    replayCustomerArImport,
    type ReplayCustomerSummary,
} from "./importArReplayService";

/** Concurrent live-refresh customers (same idea as CTV / insurance-date pools). */
export const LIVE_REFRESH_CUSTOMER_CONCURRENCY = 8;

async function runWithConcurrency<T>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<void>
): Promise<void> {
    if (items.length === 0) {
        return;
    }
    let cursor = 0;
    async function worker(): Promise<void> {
        for (;;) {
            const i = cursor++;
            if (i >= items.length) {
                return;
            }
            await fn(items[i]!);
        }
    }
    const workerCount = Math.min(Math.max(1, limit), items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
export type ArPostIngestStep =
    | "replay"
    | "maturity"
    | "process_overdue"
    | "live_refresh"
    | "as_of_enqueue";

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
    /** Invoice ids imported this sync — limits capacity-gap recompute per customer. */
    affectedInvoiceIds?: number[];
    /** Narrows replay event load; open AR before this date is seeded from DB. */
    mepBreachStartDate?: Date | null;
    /**
     * Per-customer progress for callers that show a live bar. `total` counts
     * every customer-step this run will perform, so it stays accurate whether
     * one credit step is enabled or all three. `detail` reports progress inside
     * the current step, which is what the user actually watches when a single
     * customer has thousands of invoices.
     */
    onProgress?: (progress: ArPostIngestProgress) => void;
};

export type ArPostIngestProgress = {
    completed: number;
    total: number;
    step?: ArPostIngestStep;
    customerId?: number;
    detail?: { processed: number; total: number };
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
        mepBreachStartDate?: Date | null;
        onProgress?: (progress: { processed: number; total: number }) => void;
    }) => Promise<ReplayCustomerSummary | void>;
    applyMaturity: (
        accountId: number,
        asOf: Date
    ) => Promise<MaturityResult | void>;
    /** Full Process Overdue Invoices for touched customers (daily-cron behavior). */
    processOverdueCustomers: (customerIds: number[]) => Promise<void>;
    /**
     * One customer at a time: live MEP/gap refresh, then restamp open-invoice
     * CTV/terms (refreshTermsBreachFlags) so re-import does not leave stale
     * ctv_customer_overdue_mep when overdue_block is already true.
     */
    liveRefreshCustomer: (
        customerId: number,
        asOf?: Date,
        invoiceIds?: number[]
    ) => Promise<void>;
    enqueueAsOfRewrite: (args: {
        accountId: number;
        importType: "Invoice" | "Payment";
        entityIds: number[];
        customerIds: number[];
    }) => Promise<void>;
    logError?: (
        message: string,
        meta?: Record<string, unknown>
    ) => void;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
}

function defaultLogError(
    message: string,
    meta?: Record<string, unknown>
): void {
    console.error(`[arPostIngest] ${message}`, meta ?? {});
}

export async function defaultAccountHasCreditInsurance(
    accountId: number
): Promise<boolean> {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { has_credit_insurance: true },
    });
    return account?.has_credit_insurance === true;
}

export function createDefaultArPostIngestDeps(): ArPostIngestDeps {
    return {
        accountHasCreditInsurance: defaultAccountHasCreditInsurance,
        replayCustomer: ({ customerId, accountId, mepBreachStartDate, onProgress }) =>
            replayCustomerArImport({
                customerId,
                accountId,
                mepBreachStartDate,
                onProgress,
                // After linking deferred payments, restamp CTV including
                // ctv_customer_overdue_mep from as-of issue-date block state.
                stampInsuranceFields: true,
            }),
        applyMaturity: (accountId, asOf) =>
            applyMaturedDeferredPayments(prisma, accountId, asOf),
        processOverdueCustomers: async (customerIds) => {
            if (customerIds.length === 0) {
                return;
            }
            const scope =
                customerIds.length === 1
                    ? customerIds[0]
                    : { customerIds };
            await handleOverdueInvoices(prisma, scope);
        },
        // Live MEP/gap refresh, then always restamp open-invoice CTV/terms.
        // Without refreshTermsBreachFlags, CTV only updates when overdue_block
        // flips — re-import of already-blocked customers left stale
        // ctv_customer_overdue_mep (false positives on historical invoices).
        liveRefreshCustomer: (customerId, asOf, invoiceIds) =>
            syncCustomerInsuranceFields(customerId, {
                runFollowUpEffects: true,
                refreshTermsBreachFlags: true,
                ...(invoiceIds?.length ? { invoiceIds } : {}),
                ...(asOf ? { asOfDate: asOf } : {}),
            }),
        enqueueAsOfRewrite: (args) => enqueueRewriteForImport(args),
        logError: defaultLogError,
    };
}

/**
 * Run post-ingest AR refresh for affected customers.
 * Process Overdue runs for every account; replay / maturity / live refresh
 * (and in-orchestrator as-of) remain credit-insurance-gated.
 * Customers are processed one at a time for replay. Live refresh runs a
 * bounded worker pool across customers (see {@link LIVE_REFRESH_CUSTOMER_CONCURRENCY}).
 * Process Overdue runs once per batch of touched customers.
 */
export async function runArPostIngestForCustomers(
    options: RunArPostIngestOptions,
    deps: ArPostIngestDeps = createDefaultArPostIngestDeps()
): Promise<ArPostIngestResult> {
    const errors: ArPostIngestError[] = [];
    const logError = deps.logError ?? defaultLogError;
    const customerIds = Array.from(
        new Set(options.customerIds.filter(Number.isFinite))
    );

    const invoiceIdsByCustomer = new Map<number, number[]>();
    if (options.affectedInvoiceIds?.length) {
        const rows = await prisma.invoice.findMany({
            where: { id: { in: options.affectedInvoiceIds } },
            select: { id: true, customer_id: true },
        });
        for (const row of rows) {
            if (row.customer_id == null) continue;
            const list = invoiceIdsByCustomer.get(row.customer_id) ?? [];
            list.push(row.id);
            invoiceIdsByCustomer.set(row.customer_id, list);
        }
    }

    if (options.dryRun === true) {
        return {
            skipped: true,
            skipReason: "dry_run",
            errors: [],
        };
    }

    let hasCreditInsurance = false;
    try {
        hasCreditInsurance = await deps.accountHasCreditInsurance(
            options.accountId
        );
    } catch (error) {
        const message = errorMessage(error);
        const stack = errorStack(error);
        logError(
            "credit-insurance gate failed; treating as non-CI for credit steps",
            {
                accountId: options.accountId,
                message,
                stack,
            }
        );
        errors.push({ step: "replay", message, ...(stack ? { stack } : {}) });
        hasCreditInsurance = false;
    }

    const runProcessOverdueStep = options.runProcessOverdue !== false;
    const perCustomerSteps =
        (hasCreditInsurance && options.runReplay ? 1 : 0) +
        (runProcessOverdueStep ? 1 : 0) +
        (hasCreditInsurance && options.runLiveRefresh ? 1 : 0);
    const progressTotal = customerIds.length * perCustomerSteps;
    let progressCompleted = 0;
    // Reported after each customer-step, success or failure: the bar tracks
    // work done, not work that succeeded.
    const advanceProgress = (step: ArPostIngestStep, customerId: number) => {
        if (progressTotal === 0) {
            return;
        }
        progressCompleted += 1;
        options.onProgress?.({
            completed: progressCompleted,
            total: progressTotal,
            step,
            customerId,
        });
    };
    /** Progress inside the current step (e.g. replay events for one customer). */
    const reportStepDetail = (
        step: ArPostIngestStep,
        customerId: number,
        detail: { processed: number; total: number }
    ) => {
        options.onProgress?.({
            completed: progressCompleted,
            total: progressTotal,
            step,
            customerId,
            detail,
        });
    };

    // --- Credit-insurance-gated steps ---
    if (hasCreditInsurance && options.runReplay) {
        for (const customerId of customerIds) {
            try {
                await deps.replayCustomer({
                    customerId,
                    accountId: options.accountId,
                    mepBreachStartDate: options.mepBreachStartDate,
                    onProgress: (detail) =>
                        reportStepDetail("replay", customerId, detail),
                });
            } catch (error) {
                const message = errorMessage(error);
                const stack = errorStack(error);
                logError("replay failed", {
                    accountId: options.accountId,
                    customerId,
                    message,
                    stack,
                });
                errors.push({
                    step: "replay",
                    customerId,
                    message,
                    ...(stack ? { stack } : {}),
                });
            }
            advanceProgress("replay", customerId);
        }
    }

    if (hasCreditInsurance && options.runMaturity) {
        try {
            await deps.applyMaturity(
                options.accountId,
                options.maturityAsOf ?? new Date()
            );
        } catch (error) {
            const message = errorMessage(error);
            const stack = errorStack(error);
            logError("maturity failed", {
                accountId: options.accountId,
                message,
                stack,
            });
            errors.push({
                step: "maturity",
                message,
                ...(stack ? { stack } : {}),
            });
        }
    }

    // --- All accounts: Process Overdue Invoices (default on) ---
    if (runProcessOverdueStep && customerIds.length > 0) {
        try {
            await deps.processOverdueCustomers(customerIds);
        } catch (error) {
            const message = errorMessage(error);
            const stack = errorStack(error);
            logError("process overdue failed", {
                accountId: options.accountId,
                customerIds,
                message,
                stack,
            });
            errors.push({
                step: "process_overdue",
                message,
                ...(stack ? { stack } : {}),
            });
        }
        for (const customerId of customerIds) {
            advanceProgress("process_overdue", customerId);
        }
    }

    // --- Credit-insurance-gated: live refresh + as-of ---
    if (hasCreditInsurance && options.runLiveRefresh) {
        await runWithConcurrency(
            customerIds,
            LIVE_REFRESH_CUSTOMER_CONCURRENCY,
            async (customerId) => {
                try {
                    await deps.liveRefreshCustomer(
                        customerId,
                        options.liveRefreshAsOf,
                        invoiceIdsByCustomer.get(customerId)
                    );
                } catch (error) {
                    const message = errorMessage(error);
                    const stack = errorStack(error);
                    logError("live refresh failed", {
                        accountId: options.accountId,
                        customerId,
                        message,
                        stack,
                    });
                    errors.push({
                        step: "live_refresh",
                        customerId,
                        message,
                        ...(stack ? { stack } : {}),
                    });
                }
                advanceProgress("live_refresh", customerId);
            }
        );
    }

    if (hasCreditInsurance && options.enqueueAsOfRewrite) {
        const asOf = options.asOfRewrite;
        if (!asOf?.importType || !asOf.entityIds) {
            const message =
                "enqueueAsOfRewrite requires asOfRewrite.importType and entityIds";
            logError(message, { accountId: options.accountId });
            errors.push({ step: "as_of_enqueue", message });
        } else {
            try {
                await deps.enqueueAsOfRewrite({
                    accountId: options.accountId,
                    importType: asOf.importType,
                    entityIds: asOf.entityIds,
                    customerIds,
                });
            } catch (error) {
                const message = errorMessage(error);
                const stack = errorStack(error);
                logError("as-of enqueue failed", {
                    accountId: options.accountId,
                    message,
                    stack,
                });
                errors.push({
                    step: "as_of_enqueue",
                    message,
                    ...(stack ? { stack } : {}),
                });
            }
        }
    }

    if (errors.length > 0) {
        try {
            const { enqueueArPostIngestRetries } = await import(
                "./arPostIngestRetryQueue"
            );
            await enqueueArPostIngestRetries(options.accountId, errors);
        } catch (error) {
            logError("post-ingest retry enqueue failed", {
                accountId: options.accountId,
                message: errorMessage(error),
                stack: errorStack(error),
            });
        }
    }

    if (!hasCreditInsurance) {
        return {
            skipped: true,
            skipReason: "no_credit_insurance",
            errors,
        };
    }

    return { skipped: false, errors };
}
