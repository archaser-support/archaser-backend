"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultAccountHasCreditInsurance = defaultAccountHasCreditInsurance;
exports.createDefaultArPostIngestDeps = createDefaultArPostIngestDeps;
exports.runArPostIngestForCustomers = runArPostIngestForCustomers;
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
const billing_connector_1 = require("@archaser/billing-connector");
const credit_insurance_domain_1 = require("@archaser/credit-insurance-domain");
const handleOverdueInvoices_1 = require("../handleOverdueInvoices");
const importArReplayService_1 = require("./importArReplayService");
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function errorStack(error) {
    return error instanceof Error ? error.stack : undefined;
}
function defaultLogError(message, meta) {
    console.error(`[arPostIngest] ${message}`, meta ?? {});
}
async function defaultAccountHasCreditInsurance(accountId) {
    const account = await credit_insurance_domain_1.creditInsurancePrisma.account.findUnique({
        where: { id: accountId },
        select: { has_credit_insurance: true },
    });
    return account?.has_credit_insurance === true;
}
function createDefaultArPostIngestDeps() {
    return {
        accountHasCreditInsurance: defaultAccountHasCreditInsurance,
        replayCustomer: ({ customerId, accountId, onProgress }) => (0, importArReplayService_1.replayCustomerArImport)({ customerId, accountId, onProgress }),
        applyMaturity: (accountId, asOf) => (0, billing_connector_1.applyMaturedDeferredPayments)(credit_insurance_domain_1.creditInsurancePrisma, accountId, asOf),
        processOverdueCustomer: async (customerId) => {
            await (0, handleOverdueInvoices_1.handleOverdueInvoices)(credit_insurance_domain_1.creditInsurancePrisma, customerId);
        },
        // Same follow-up as triggerPostImportOverdueMetrics (MEP + gap pipeline).
        liveRefreshCustomer: (customerId, asOf) => (0, credit_insurance_domain_1.syncCustomerInsuranceFields)(customerId, {
            runFollowUpEffects: true,
            ...(asOf ? { asOfDate: asOf } : {}),
        }),
        enqueueAsOfRewrite: (args) => (0, credit_insurance_domain_1.enqueueRewriteForImport)(args),
        logError: defaultLogError,
    };
}
/**
 * Run post-ingest AR refresh for affected customers.
 * Process Overdue runs for every account; replay / maturity / live refresh
 * (and in-orchestrator as-of) remain credit-insurance-gated.
 * Customers are processed one at a time for replay, overdue, and live refresh.
 */
async function runArPostIngestForCustomers(options, deps = createDefaultArPostIngestDeps()) {
    const errors = [];
    const logError = deps.logError ?? defaultLogError;
    const customerIds = Array.from(new Set(options.customerIds.filter(Number.isFinite)));
    if (options.dryRun === true) {
        return {
            skipped: true,
            skipReason: "dry_run",
            errors: [],
        };
    }
    let hasCreditInsurance = false;
    try {
        hasCreditInsurance = await deps.accountHasCreditInsurance(options.accountId);
    }
    catch (error) {
        const message = errorMessage(error);
        const stack = errorStack(error);
        logError("credit-insurance gate failed; treating as non-CI for credit steps", {
            accountId: options.accountId,
            message,
            stack,
        });
        errors.push({ step: "replay", message, ...(stack ? { stack } : {}) });
        hasCreditInsurance = false;
    }
    const runProcessOverdueStep = options.runProcessOverdue !== false;
    const perCustomerSteps = (hasCreditInsurance && options.runReplay ? 1 : 0) +
        (runProcessOverdueStep ? 1 : 0) +
        (hasCreditInsurance && options.runLiveRefresh ? 1 : 0);
    const progressTotal = customerIds.length * perCustomerSteps;
    let progressCompleted = 0;
    // Reported after each customer-step, success or failure: the bar tracks
    // work done, not work that succeeded.
    const advanceProgress = (step, customerId) => {
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
    const reportStepDetail = (step, customerId, detail) => {
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
                    onProgress: (detail) => reportStepDetail("replay", customerId, detail),
                });
            }
            catch (error) {
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
            await deps.applyMaturity(options.accountId, options.maturityAsOf ?? new Date());
        }
        catch (error) {
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
    if (runProcessOverdueStep) {
        for (const customerId of customerIds) {
            try {
                await deps.processOverdueCustomer(customerId);
            }
            catch (error) {
                const message = errorMessage(error);
                const stack = errorStack(error);
                logError("process overdue failed", {
                    accountId: options.accountId,
                    customerId,
                    message,
                    stack,
                });
                errors.push({
                    step: "process_overdue",
                    customerId,
                    message,
                    ...(stack ? { stack } : {}),
                });
            }
            advanceProgress("process_overdue", customerId);
        }
    }
    // --- Credit-insurance-gated: live refresh + as-of ---
    if (hasCreditInsurance && options.runLiveRefresh) {
        for (const customerId of customerIds) {
            try {
                await deps.liveRefreshCustomer(customerId, options.liveRefreshAsOf);
            }
            catch (error) {
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
    }
    if (hasCreditInsurance && options.enqueueAsOfRewrite) {
        const asOf = options.asOfRewrite;
        if (!asOf?.importType || !asOf.entityIds) {
            const message = "enqueueAsOfRewrite requires asOfRewrite.importType and entityIds";
            logError(message, { accountId: options.accountId });
            errors.push({ step: "as_of_enqueue", message });
        }
        else {
            try {
                await deps.enqueueAsOfRewrite({
                    accountId: options.accountId,
                    importType: asOf.importType,
                    entityIds: asOf.entityIds,
                    customerIds,
                });
            }
            catch (error) {
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
            const { enqueueArPostIngestRetries } = await Promise.resolve().then(() => __importStar(require("./arPostIngestRetryQueue")));
            await enqueueArPostIngestRetries(options.accountId, errors);
        }
        catch (error) {
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
