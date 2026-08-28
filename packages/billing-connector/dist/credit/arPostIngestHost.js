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
exports.refreshInsuranceTargetDatesViaHost = refreshInsuranceTargetDatesViaHost;
exports.runArPostIngestViaHost = runArPostIngestViaHost;
exports.invokeConnectorArPostIngest = invokeConnectorArPostIngest;
const path = __importStar(require("path"));
function resolveCreditInsuranceDomainRoot() {
    if (process.env.CREDIT_INSURANCE_DOMAIN_ROOT?.trim()) {
        return path.resolve(process.env.CREDIT_INSURANCE_DOMAIN_ROOT.trim());
    }
    // packages/billing-connector/dist/credit → ../../../api/dist/credit-insurance
    return path.resolve(__dirname, "../../../api/dist/credit-insurance");
}
/**
 * Recompute invoice insurance target dates after amount/date upserts.
 * Uses the same Nest credit-insurance refresh as API due-date edits.
 */
async function refreshInsuranceTargetDatesViaHost(invoiceIds, prisma) {
    if (invoiceIds.length === 0) {
        return 0;
    }
    const root = resolveCreditInsuranceDomainRoot();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const domainDb = require(path.join(root, "domain-db.js"));
    domainDb.bindCreditInsurancePrisma(prisma);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const breachMod = require(path.join(root, "domain/syncInvoiceReportingBreach.js"));
    return breachMod.refreshInsuranceTargetDatesForInvoiceIds(invoiceIds, prisma);
}
/**
 * Default post-Invoice / payment-only AR post-ingest when the host does not
 * pass onArPostIngest (queue worker, scheduled sync, internal inline).
 */
async function runArPostIngestViaHost(input, prisma) {
    const root = resolveCreditInsuranceDomainRoot();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const domainDb = require(path.join(root, "domain-db.js"));
    domainDb.bindCreditInsurancePrisma(prisma);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const orch = require(path.join(root, "domain/arPostIngestOrchestrator.js"));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asOfMod = require(path.join(root, "domain/asOfRewriteQueue.js"));
    const result = await orch.runArPostIngestForCustomers({
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
    });
    // Match file-import: collection-only still enqueues as-of rewrite.
    if (result.skipped &&
        input.enqueueAsOfRewrite === true &&
        input.asOfRewrite) {
        await asOfMod.enqueueRewriteForImport({
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
        });
        params.log(`AR post-ingest finished for ${customerIds.length} customer(s)`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "AR post-ingest failed";
        params.log(`AR post-ingest failed: ${message}`);
    }
}
