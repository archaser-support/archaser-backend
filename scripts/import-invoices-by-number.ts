/**
 * Import a specific list of Priority invoice document numbers (IVNUM) for one
 * customer, by temporarily narrowing the account's connector pull filters.
 *
 * The connector has no per-document import entry point, so the filters are
 * backed up, replaced, used for a single run, and restored in a finally block.
 *
 * Wires the same post-import host callbacks as the billing integration page:
 * Process Overdue, AR post-ingest (replay / live refresh / as-of), and
 * customer balance recalculation.
 *
 * Usage:
 *   npx tsx scripts/import-invoices-by-number.ts --customer 4036 --invoices SI240003534,CR250000836
 *   npx tsx scripts/import-invoices-by-number.ts --customer 4036 --invoices ... --import
 *   npx tsx scripts/import-invoices-by-number.ts --customer 4036 --invoices ... --import --from 2024-01-01
 */
import "dotenv/config";
import * as path from "path";
import { PrismaClient, type Prisma } from "@prisma/client";

import {
    handleOverdueInvoices,
    runArPostIngestForCustomers,
} from "@archaser/cron-jobs";
import {
    bindCreditInsurancePrisma,
    enqueueRewriteForImport,
} from "@archaser/credit-insurance-domain";

import { recalculateCustomerAmounts } from "../api/src/customers/domain/recalculateCustomerAmounts";
import { runPreviewSync } from "../packages/billing-connector/src/sync/runPreviewSync";
import { runInProcessSync } from "../packages/billing-connector/src/sync/runInProcessSync";

// Host default resolves packages/api; this repo keeps api at the repo root.
if (!process.env.CUSTOMERS_DOMAIN_ROOT) {
    process.env.CUSTOMERS_DOMAIN_ROOT = path.resolve(
        __dirname,
        "../api/dist/customers"
    );
}

interface Args {
    customerId: number;
    invoiceNumbers: string[];
    apply: boolean;
    /** Overrides the account's backfill_start_date for this run only. */
    from: Date | null;
}

function parseArgs(argv: string[]): Args {
    const get = (flag: string): string | undefined => {
        const index = argv.indexOf(flag);
        return index === -1 ? undefined : argv[index + 1];
    };
    const customer = Number(get("--customer"));
    const invoices = (get("--invoices") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    if (!Number.isInteger(customer) || customer <= 0) {
        throw new Error("--customer <id> is required");
    }
    if (invoices.length === 0) {
        throw new Error("--invoices <IVNUM,IVNUM,...> is required");
    }
    const fromRaw = get("--from");
    let from: Date | null = null;
    if (fromRaw) {
        from = new Date(`${fromRaw}T00:00:00.000Z`);
        if (Number.isNaN(from.getTime())) {
            throw new Error(`--from must be YYYY-MM-DD, got "${fromRaw}"`);
        }
    }
    return {
        customerId: customer,
        invoiceNumbers: invoices,
        apply: argv.includes("--import"),
        from,
    };
}

function escapeOData(value: string): string {
    return value.replace(/'/g, "''");
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    const customer = await prisma.customer.findUnique({
        where: { id: args.customerId },
        select: { id: true, account_id: true, customer_number: true },
    });
    if (!customer) {
        throw new Error(`Customer ${args.customerId} not found`);
    }
    if (!customer.customer_number) {
        throw new Error(
            `Customer ${args.customerId} has no customer_number (Priority CUSTNAME)`
        );
    }
    const accountId = customer.account_id;

    const connector = await prisma.billingConnector.findUnique({
        where: { account_id: accountId },
        select: { id: true, pull_filters: true, enabled_entities: true },
    });
    if (!connector) {
        throw new Error(`No billing connector for account ${accountId}`);
    }

    const invoiceOData = args.invoiceNumbers
        .map((ivnum) => `IVNUM eq '${escapeOData(ivnum)}'`)
        .join(" or ");
    const scopedFilters = {
        Customer: {
            mode: "rules",
            rules: [
                {
                    field: "CUSTNAME",
                    operator: "eq",
                    value: customer.customer_number,
                },
            ],
        },
        Invoice: { mode: "advanced", odata: invoiceOData },
    };

    console.log("[import-invoices] target:", {
        customerId: customer.id,
        accountId,
        custname: customer.customer_number,
        invoiceCount: args.invoiceNumbers.length,
        invoiceNumbers: args.invoiceNumbers.join(","),
        mode: args.apply ? "import" : "preview",
        windowFrom: args.from ? args.from.toISOString() : "connector default",
    });

    const originalFilters = connector.pull_filters;
    const originalEntities = connector.enabled_entities;

    try {
        await prisma.billingConnector.update({
            where: { id: connector.id },
            data: {
                pull_filters: scopedFilters as Prisma.InputJsonValue,
                ...(args.apply ? { enabled_entities: ["Invoice"] } : {}),
            },
        });

        if (!args.apply) {
            const preview = await runPreviewSync({
                prisma,
                accountId,
                importType: "Invoice",
            });
            for (const entity of preview.entities) {
                console.log("[import-invoices] preview entity:", {
                    importType: entity.import_type,
                    pulled: entity.pulled,
                    effectiveFilter: entity.effective_filter,
                    validationErrorCount: entity.validation_errors.length,
                    validationErrors: entity.validation_errors.join(" | "),
                });
                for (const row of entity.sample_rows) {
                    console.log(
                        "[import-invoices] sample row:",
                        JSON.stringify(row)
                    );
                }
            }
            console.log("[import-invoices] go/no-go:", {
                passed: preview.go_no_go.passed,
                requiredFieldErrors: preview.go_no_go.required_field_errors,
                checks: preview.go_no_go.checks
                    .map((check) => `${check.id}:${check.passed}`)
                    .join(", "),
            });
            return;
        }

        const onLog = (message: string) =>
            console.log("[import-invoices] sync:", message);

        const result = await runInProcessSync({
            prisma,
            accountId,
            trigger: "manual-invoice-number-import",
            mode: "backfill",
            ...(args.from
                ? { windows: [{ start: args.from, end: new Date() }] }
                : {}),
            onLog,
            onCustomerBalancesFinal: async (customerIds, options) => {
                await recalculateCustomerAmounts(customerIds, prisma, options);
            },
            onProcessOverdueCustomers: async (customerIds) => {
                if (customerIds.length === 0) {
                    return;
                }
                const scope =
                    customerIds.length === 1
                        ? customerIds[0]
                        : { customerIds };
                await handleOverdueInvoices(prisma, scope);
            },
            onArPostIngest: async (input) => {
                bindCreditInsurancePrisma(prisma);
                let skipped = false;
                let thrown: unknown;
                try {
                    const postIngest = await runArPostIngestForCustomers({
                        accountId: input.accountId,
                        customerIds: input.customerIds,
                        runReplay: input.runReplay === true,
                        runMaturity: input.runMaturity === true,
                        ...(input.runProcessOverdue !== undefined
                            ? { runProcessOverdue: input.runProcessOverdue }
                            : {}),
                        runLiveRefresh: input.runLiveRefresh === true,
                        enqueueAsOfRewrite: input.enqueueAsOfRewrite === true,
                        dryRun: input.dryRun === true,
                        asOfRewrite: input.asOfRewrite,
                        ...(input.affectedInvoiceIds !== undefined
                            ? { affectedInvoiceIds: input.affectedInvoiceIds }
                            : {}),
                        ...(input.mepBreachStartDate !== undefined
                            ? { mepBreachStartDate: input.mepBreachStartDate }
                            : {}),
                        ...(input.onProgress
                            ? { onProgress: input.onProgress }
                            : {}),
                    });
                    skipped = postIngest.skipped;
                    for (const failure of postIngest.errors) {
                        onLog(
                            `AR post-ingest step "${failure.step}" failed` +
                                (failure.customerId != null
                                    ? ` for customer ${failure.customerId}`
                                    : "") +
                                `: ${failure.message}`
                        );
                    }
                    if (postIngest.skipReason) {
                        onLog(
                            `AR post-ingest skipped: ${postIngest.skipReason}`
                        );
                    }
                } catch (error) {
                    skipped = true;
                    thrown = error;
                    const message =
                        error instanceof Error ? error.message : String(error);
                    onLog(`AR post-ingest failed: ${message}`);
                }
                if (
                    skipped &&
                    input.enqueueAsOfRewrite &&
                    input.asOfRewrite
                ) {
                    try {
                        await enqueueRewriteForImport({
                            accountId: input.accountId,
                            importType: input.asOfRewrite.importType,
                            entityIds: input.asOfRewrite.entityIds,
                            customerIds: input.customerIds,
                        });
                    } catch {
                        // Best-effort; do not fail sync for as-of enqueue.
                    }
                }
                if (thrown) {
                    throw thrown;
                }
            },
        });
        console.log("[import-invoices] result:", {
            ok: result.ok,
            message: result.message,
            error: result.error ?? null,
            invoicesProcessed: result.stats.invoicesProcessed,
            invoicesImported: result.stats.invoicesImported,
            importErrors: result.stats.importErrors,
        });
    } finally {
        await prisma.billingConnector.update({
            where: { id: connector.id },
            data: {
                pull_filters: originalFilters as Prisma.InputJsonValue,
                enabled_entities: originalEntities as Prisma.InputJsonValue,
            },
        });
        console.log("[import-invoices] restored original pull filters");
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error("[import-invoices] failed:", error);
    process.exit(1);
});
