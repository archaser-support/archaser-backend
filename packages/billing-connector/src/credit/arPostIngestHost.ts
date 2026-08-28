import * as path from "path";
import type { PrismaClient } from "@prisma/client";

/**
 * Args for connector post-ingest (mirrors Nest runArPostIngestForCustomers options).
 * Host callback or require — billing-connector must not hard-depend on Nest.
 */
export type ArPostIngestHostInput = {
    accountId: number;
    customerIds: number[];
    runReplay?: boolean;
    runMaturity?: boolean;
    /** Process Overdue for touched customers (default true in Nest orchestrator). */
    runProcessOverdue?: boolean;
    runLiveRefresh?: boolean;
    enqueueAsOfRewrite?: boolean;
    /** Preview / dry-run: Nest orchestrator skips all side effects when true. */
    dryRun?: boolean;
    asOfRewrite?: {
        importType: "Invoice" | "Payment";
        entityIds: number[];
    };
};

export type ArPostIngestHostFn = (
    input: ArPostIngestHostInput
) => Promise<void>;

function resolveCreditInsuranceDomainRoot(): string {
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
export async function refreshInsuranceTargetDatesViaHost(
    invoiceIds: number[],
    prisma: PrismaClient
): Promise<number> {
    if (invoiceIds.length === 0) {
        return 0;
    }
    const root = resolveCreditInsuranceDomainRoot();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const domainDb = require(path.join(root, "domain-db.js")) as {
        bindCreditInsurancePrisma: (client: PrismaClient) => void;
    };
    domainDb.bindCreditInsurancePrisma(prisma);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const breachMod = require(
        path.join(root, "domain/syncInvoiceReportingBreach.js")
    ) as {
        refreshInsuranceTargetDatesForInvoiceIds: (
            ids: number[],
            db?: PrismaClient
        ) => Promise<number>;
    };
    return breachMod.refreshInsuranceTargetDatesForInvoiceIds(
        invoiceIds,
        prisma
    );
}

/**
 * Default post-Invoice / payment-only AR post-ingest when the host does not
 * pass onArPostIngest (queue worker, scheduled sync, internal inline).
 */
export async function runArPostIngestViaHost(
    input: ArPostIngestHostInput,
    prisma: PrismaClient
): Promise<void> {
    const root = resolveCreditInsuranceDomainRoot();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const domainDb = require(path.join(root, "domain-db.js")) as {
        bindCreditInsurancePrisma: (client: PrismaClient) => void;
    };
    domainDb.bindCreditInsurancePrisma(prisma);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const orch = require(
        path.join(root, "domain/arPostIngestOrchestrator.js")
    ) as {
        runArPostIngestForCustomers: (
            options: ArPostIngestHostInput
        ) => Promise<{ skipped: boolean }>;
    };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asOfMod = require(path.join(root, "domain/asOfRewriteQueue.js")) as {
        enqueueRewriteForImport: (args: {
            accountId: number;
            importType: "Invoice" | "Payment";
            entityIds: number[];
            customerIds: number[];
        }) => Promise<void>;
    };

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
    if (
        result.skipped &&
        input.enqueueAsOfRewrite === true &&
        input.asOfRewrite
    ) {
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
export async function invokeConnectorArPostIngest(params: {
    accountId: number;
    customerIds: number[];
    invoiceEntityIds: number[];
    paymentEntityIds: number[];
    prisma: PrismaClient;
    onArPostIngest: ArPostIngestHostFn | undefined;
    log: (message: string) => void;
    /** When true (payment-only fallback), run deferred-payment maturity. */
    runMaturity?: boolean;
}): Promise<void> {
    const { customerIds, invoiceEntityIds, paymentEntityIds } = params;
    if (customerIds.length === 0) {
        return;
    }

    // Amount (and date) upserts must refresh insurance targets before replay
    // so sign flips apply even if later post-ingest steps are skipped.
    if (invoiceEntityIds.length > 0) {
        try {
            await refreshInsuranceTargetDatesViaHost(
                invoiceEntityIds,
                params.prisma
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            params.log(
                `Insurance target refresh after invoice upsert failed: ${message}`
            );
        }
    }

    const asOfRewrite =
        invoiceEntityIds.length > 0
            ? {
                  importType: "Invoice" as const,
                  entityIds: invoiceEntityIds,
              }
            : {
                  importType: "Payment" as const,
                  entityIds: paymentEntityIds,
              };
    const run =
        params.onArPostIngest ??
        ((input) => runArPostIngestViaHost(input, params.prisma));
    params.log(
        `AR post-ingest starting for ${customerIds.length} customer(s)…`
    );
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
        params.log(
            `AR post-ingest finished for ${customerIds.length} customer(s)`
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "AR post-ingest failed";
        params.log(`AR post-ingest failed: ${message}`);
    }
}
