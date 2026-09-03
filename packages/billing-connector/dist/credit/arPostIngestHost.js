"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFERRED_CI_POST_INGEST_STEPS = void 0;
exports.registerArPostIngestOrchestrator = registerArPostIngestOrchestrator;
exports.isArPostIngestOrchestratorRegistered = isArPostIngestOrchestratorRegistered;
exports.resetArPostIngestOrchestratorForTests = resetArPostIngestOrchestratorForTests;
exports.refreshInsuranceTargetDatesViaHost = refreshInsuranceTargetDatesViaHost;
exports.runArPostIngestViaHost = runArPostIngestViaHost;
exports.invokeConnectorArPostIngest = invokeConnectorArPostIngest;
const credit_insurance_domain_1 = require("@archaser/credit-insurance-domain");
/**
 * Host port for the AR post-ingest orchestrator.
 *
 * The orchestrator lives in `@archaser/cron-jobs`, which depends on this
 * package, so importing it back would create a cycle. Every process that can
 * reach the no-callback fallback registers it at startup instead: the api
 * (`CreditInsuranceModule`), connectors (`AppModule`) and worker (runtime start).
 */
let registeredOrchestrator;
function registerArPostIngestOrchestrator(orchestrator) {
    registeredOrchestrator = orchestrator;
}
function isArPostIngestOrchestratorRegistered() {
    return registeredOrchestrator !== undefined;
}
function resetArPostIngestOrchestratorForTests() {
    registeredOrchestrator = undefined;
}
/**
 * Recompute invoice insurance target dates after amount/date upserts.
 * Uses the same credit-insurance refresh as API due-date edits.
 */
async function refreshInsuranceTargetDatesViaHost(invoiceIds, prisma, options) {
    if (invoiceIds.length === 0) {
        return 0;
    }
    (0, credit_insurance_domain_1.bindCreditInsurancePrisma)(prisma);
    return (0, credit_insurance_domain_1.refreshInsuranceTargetDatesForInvoiceIds)(invoiceIds, prisma, {
        onProgress: options?.onProgress,
    });
}
/**
 * Default post-Invoice / payment-only AR post-ingest when the host does not
 * pass onArPostIngest (queue worker, scheduled sync, internal inline).
 */
async function runArPostIngestViaHost(input, prisma) {
    (0, credit_insurance_domain_1.bindCreditInsurancePrisma)(prisma);
    if (!registeredOrchestrator) {
        throw new Error("AR post-ingest orchestrator is not registered. Call registerArPostIngestOrchestrator(fn) during service startup, or pass onArPostIngest to the sync options.");
    }
    const result = await registeredOrchestrator({
        accountId: input.accountId,
        customerIds: input.customerIds,
        runReplay: input.runReplay === true,
        runMaturity: input.runMaturity === true,
        // Default true in Nest; only pass through when explicitly set.
        ...(input.runProcessOverdue !== undefined
            ? { runProcessOverdue: input.runProcessOverdue }
            : {}),
        runLiveRefresh: input.runLiveRefresh === true,
        enqueueAsOfRewrite: input.enqueueAsOfRewrite === true,
        dryRun: input.dryRun === true,
        asOfRewrite: input.asOfRewrite,
        ...(input.invoiceEntityIds?.length
            ? { affectedInvoiceIds: input.affectedInvoiceIds ?? input.invoiceEntityIds }
            : {}),
        ...(input.mepBreachStartDate !== undefined
            ? { mepBreachStartDate: input.mepBreachStartDate }
            : {}),
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
    for (const failure of result.errors ?? []) {
        console.error("[arPostIngestHost] post-ingest step failed", {
            accountId: input.accountId,
            step: failure.step,
            customerId: failure.customerId,
            message: failure.message,
            stack: failure.stack,
        });
    }
    // Match file-import: collection-only still enqueues as-of rewrite.
    if (result.skipped &&
        input.enqueueAsOfRewrite === true &&
        input.asOfRewrite) {
        await (0, credit_insurance_domain_1.enqueueRewriteForImport)({
            accountId: input.accountId,
            importType: input.asOfRewrite.importType,
            entityIds: input.asOfRewrite.entityIds,
            customerIds: input.customerIds,
        });
    }
}
/** Heavy CI steps deferred to the worker. Process Overdue is a separate sync tail step. */
exports.DEFERRED_CI_POST_INGEST_STEPS = [
    "replay",
    "live_refresh",
];
/**
 * Once after Invoice entity completion. Best-effort: errors are logged and do
 * not fail the sync. Caller must skip on dry-run.
 */
async function invokeConnectorArPostIngest(params) {
    const { customerIds, invoiceEntityIds, paymentEntityIds } = params;
    if (customerIds.length === 0) {
        return { deferred: false };
    }
    (0, credit_insurance_domain_1.bindCreditInsurancePrisma)(params.prisma);
    // Amount (and date) upserts must refresh insurance targets before replay
    // so sign flips apply even if later post-ingest steps are skipped.
    if (invoiceEntityIds.length > 0) {
        try {
            const total = invoiceEntityIds.length;
            let lastLogged = -1;
            params.log(`Insurance target dates starting for ${total} invoice(s)…`);
            const updated = await refreshInsuranceTargetDatesViaHost(invoiceEntityIds, params.prisma, {
                onProgress: ({ processed, total: progressTotal }) => {
                    if (processed === lastLogged) {
                        return;
                    }
                    lastLogged = processed;
                    params.log(`Insurance target dates progress: ${processed}/${progressTotal} invoice(s)`);
                },
            });
            params.log(`Insurance target dates finished for ${total} invoice(s) (${updated} updated)`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            params.log(`Insurance target refresh after invoice upsert failed: ${message}`);
        }
    }
    const asOfRewrite = invoiceEntityIds.length > 0
        ? {
            importType: "Invoice",
            entityIds: invoiceEntityIds,
        }
        : {
            importType: "Payment",
            entityIds: paymentEntityIds,
        };
    const run = params.onArPostIngest ??
        ((input) => runArPostIngestViaHost(input, params.prisma));
    const runSteps = async (args) => {
        params.log(`AR post-ingest ${args.label} for ${customerIds.length} customer(s)…`);
        try {
            await run({
                accountId: params.accountId,
                customerIds,
                runReplay: args.runReplay,
                runMaturity: args.runMaturity,
                runProcessOverdue: args.runProcessOverdue,
                runLiveRefresh: args.runLiveRefresh,
                enqueueAsOfRewrite: args.enqueueAsOfRewrite,
                ...(args.enqueueAsOfRewrite ? { asOfRewrite } : {}),
                ...(params.onProgress ? { onProgress: params.onProgress } : {}),
            });
            params.log(`AR post-ingest ${args.label} finished for ${customerIds.length} customer(s)`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "AR post-ingest failed";
            params.log(`AR post-ingest ${args.label} failed: ${message}`);
        }
    };
    const runProcessOverdue = params.runProcessOverdue !== undefined
        ? params.runProcessOverdue
        : true;
    if (params.deferPostIngest === true) {
        if (runProcessOverdue) {
            await runSteps({
                label: "process-overdue (inline fallback)",
                runReplay: false,
                runProcessOverdue: true,
                runLiveRefresh: false,
                runMaturity: params.runMaturity === true,
                enqueueAsOfRewrite: false,
            });
        }
        try {
            await (0, credit_insurance_domain_1.enqueueRewriteForImport)({
                accountId: params.accountId,
                importType: asOfRewrite.importType,
                entityIds: asOfRewrite.entityIds,
                customerIds,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            params.log(`As-of rewrite enqueue failed: ${message}`);
        }
        if (params.enqueueDeferredSteps) {
            await params.enqueueDeferredSteps({
                accountId: params.accountId,
                customerIds,
                steps: [...exports.DEFERRED_CI_POST_INGEST_STEPS],
            });
        }
        else {
            params.log("AR post-ingest defer requested but enqueueDeferredSteps is not configured");
        }
        let drainQueued = false;
        let drainReason;
        if (params.schedulePostIngestDrain) {
            try {
                const drainResult = await params.schedulePostIngestDrain();
                drainQueued = drainResult?.queued === true;
                drainReason = drainResult?.reason;
            }
            catch (error) {
                drainReason =
                    error instanceof Error ? error.message : String(error);
                params.log(`Failed to schedule AR post-ingest worker drain: ${drainReason}`);
            }
        }
        else {
            drainReason = "schedulePostIngestDrain is not configured";
        }
        if (!drainQueued) {
            params.log(`AR post-ingest drain not queued (${drainReason ?? "unknown"}); running replay/live-refresh inline`);
            await runSteps({
                label: "replay/live-refresh (inline fallback)",
                runReplay: true,
                runProcessOverdue: false,
                runLiveRefresh: true,
                runMaturity: false,
                enqueueAsOfRewrite: false,
            });
            return { deferred: false };
        }
        params.log(`Deferred replay/live-refresh for ${customerIds.length} customer(s) — worker will drain`);
        return { deferred: true };
    }
    await runSteps({
        label: "full",
        runReplay: true,
        runProcessOverdue,
        runLiveRefresh: true,
        runMaturity: params.runMaturity === true,
        enqueueAsOfRewrite: true,
    });
    return { deferred: false };
}
