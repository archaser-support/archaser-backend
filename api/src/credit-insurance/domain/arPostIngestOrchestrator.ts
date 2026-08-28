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
import { handleOverdueInvoices } from "@archaser/cron-jobs";

import { prisma } from "../domain-db";
import { enqueueRewriteForImport } from "./asOfRewriteQueue";
import {
    replayCustomerArImport,
    type ReplayCustomerSummary,
} from "./importArReplayService";
import { syncCustomerInsuranceFields } from "./syncCustomerInsuranceFields";

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
    /** Required when enqueueAsOfRewrite is true. */
    asOfRewrite?: {
        importType: "Invoice" | "Payment";
        entityIds: number[];
    };
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
    applyMaturity: (
        accountId: number,
        asOf: Date
    ) => Promise<MaturityResult | void>;
    /** Full Process Overdue Invoices for one customer (daily-cron behavior). */
    processOverdueCustomer: (customerId: number) => Promise<void>;
    /** One customer at a time — same follow-up as triggerPostImportOverdueMetrics. */
    liveRefreshCustomer: (customerId: number) => Promise<void>;
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
        replayCustomer: ({ customerId, accountId }) =>
            replayCustomerArImport({ customerId, accountId }),
        applyMaturity: (accountId, asOf) =>
            applyMaturedDeferredPayments(prisma, accountId, asOf),
        processOverdueCustomer: async (customerId) => {
            await handleOverdueInvoices(prisma, customerId);
        },
        // Same follow-up as triggerPostImportOverdueMetrics (MEP + gap pipeline).
        liveRefreshCustomer: (customerId) =>
            syncCustomerInsuranceFields(customerId, {
                runFollowUpEffects: true,
            }),
        enqueueAsOfRewrite: (args) => enqueueRewriteForImport(args),
        logError: defaultLogError,
    };
}

/**
 * Run post-ingest AR refresh for affected customers.
 * Process Overdue runs for every account; replay / maturity / live refresh
 * (and in-orchestrator as-of) remain credit-insurance-gated.
 * Customers are processed one at a time for replay, overdue, and live refresh.
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
        logError(
            "credit-insurance gate failed; treating as non-CI for credit steps",
            {
                accountId: options.accountId,
                message,
            }
        );
        errors.push({ step: "replay", message });
        hasCreditInsurance = false;
    }

    // --- Credit-insurance-gated steps ---
    if (hasCreditInsurance && options.runReplay) {
        for (const customerId of customerIds) {
            try {
                await deps.replayCustomer({
                    customerId,
                    accountId: options.accountId,
                });
            } catch (error) {
                const message = errorMessage(error);
                logError("replay failed", {
                    accountId: options.accountId,
                    customerId,
                    message,
                });
                errors.push({ step: "replay", customerId, message });
            }
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
            logError("maturity failed", {
                accountId: options.accountId,
                message,
            });
            errors.push({ step: "maturity", message });
        }
    }

    // --- All accounts: Process Overdue Invoices (default on) ---
    const runProcessOverdue = options.runProcessOverdue !== false;
    if (runProcessOverdue) {
        for (const customerId of customerIds) {
            try {
                await deps.processOverdueCustomer(customerId);
            } catch (error) {
                const message = errorMessage(error);
                logError("process overdue failed", {
                    accountId: options.accountId,
                    customerId,
                    message,
                });
                errors.push({
                    step: "process_overdue",
                    customerId,
                    message,
                });
            }
        }
    }

    // --- Credit-insurance-gated: live refresh + as-of ---
    if (hasCreditInsurance && options.runLiveRefresh) {
        for (const customerId of customerIds) {
            try {
                await deps.liveRefreshCustomer(customerId);
            } catch (error) {
                const message = errorMessage(error);
                logError("live refresh failed", {
                    accountId: options.accountId,
                    customerId,
                    message,
                });
                errors.push({ step: "live_refresh", customerId, message });
            }
        }
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
                logError("as-of enqueue failed", {
                    accountId: options.accountId,
                    message,
                });
                errors.push({ step: "as_of_enqueue", message });
            }
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
