"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
async function refreshInsuranceTargetDatesViaHost(invoiceIds, prisma) {
    if (invoiceIds.length === 0) {
        return 0;
    }
    (0, credit_insurance_domain_1.bindCreditInsurancePrisma)(prisma);
    return (0, credit_insurance_domain_1.refreshInsuranceTargetDatesForInvoiceIds)(invoiceIds, prisma);
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
/**
 * Once after Invoice entity completion. Best-effort: errors are logged and do
 * not fail the sync. Caller must skip on dry-run.
 */
async function invokeConnectorArPostIngest(params) {
    const { customerIds, invoiceEntityIds, paymentEntityIds } = params;
    if (customerIds.length === 0) {
        return;
    }
    // Amount (and date) upserts must refresh insurance targets before replay
    // so sign flips apply even if later post-ingest steps are skipped.
    if (invoiceEntityIds.length > 0) {
        try {
            await refreshInsuranceTargetDatesViaHost(invoiceEntityIds, params.prisma);
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
    params.log(`AR post-ingest starting for ${customerIds.length} customer(s)…`);
    try {
        await run({
            accountId: params.accountId,
            customerIds,
            runReplay: true,
            runMaturity: params.runMaturity === true,
            runLiveRefresh: true,
            enqueueAsOfRewrite: true,
            asOfRewrite,
            ...(params.onProgress ? { onProgress: params.onProgress } : {}),
        });
        params.log(`AR post-ingest finished for ${customerIds.length} customer(s)`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "AR post-ingest failed";
        params.log(`AR post-ingest failed: ${message}`);
    }
}
