/**
 * Shrink/delete surplus virtual payments on overpaid invoices.
 *
 * After recon virtual fill, AR replay can link deferred cash without re-trimming
 * the virtual — paid becomes ~2× net. This repair finds overpaid invoices that
 * still have a virtual payment, shrinks/deletes the virtual to leftover only,
 * then recalcs paid totals.
 *
 * Overpay rule: |customer_total_paid| > |customer_net_amount| + paid tolerance.
 *
 * Usage:
 *   npx tsx scripts/datafixes/trim-surplus-virtual-payments.ts --account 10149 --dry-run
 *   npx tsx scripts/datafixes/trim-surplus-virtual-payments.ts --account 10149 --fix
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

import { recalculateInvoicesFromLinkedPayments } from "../../packages/billing-connector/src/invoice/linkDeferredPaymentAndRecalc";
import { resolveInvoicePaidTolerance } from "../../packages/billing-connector/src/invoice/invoicePaidTolerance";
import {
    VIRTUAL_PAYMENT_METHOD,
    isAbsOverpaidInvoice,
    shrinkOrDeleteVirtualPaymentsForInvoiceIds,
} from "../../packages/billing-connector/src/payment/virtualPaymentTrim";

function parseArgs(argv: string[]): {
    accountId: number;
    dryRun: boolean;
    fix: boolean;
} {
    const index = argv.indexOf("--account");
    const accountId = Number(index === -1 ? NaN : argv[index + 1]);
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new Error("--account <id> is required");
    }
    const dryRun = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }
    return { accountId, dryRun, fix };
}

async function main(): Promise<void> {
    const { accountId, fix } = parseArgs(process.argv);
    const prisma = new PrismaClient();

    try {
        const paidTolerance = await resolveInvoicePaidTolerance(
            prisma,
            accountId
        );

        const virtualPayments = await prisma.invoicePayment.findMany({
            where: {
                account_id: accountId,
                payment_method: VIRTUAL_PAYMENT_METHOD,
                invoice_id: { not: null },
            },
            select: {
                id: true,
                invoice_id: true,
                invoice_number: true,
                customer_amount: true,
                reference: true,
            },
        });

        const invoiceIds = Array.from(
            new Set(
                virtualPayments
                    .map((row) => row.invoice_id)
                    .filter((id): id is number => id != null)
            )
        );

        if (invoiceIds.length === 0) {
            console.log("[trim-surplus-virtual] no virtual payments", {
                accountId,
                mode: fix ? "fix" : "dry-run",
            });
            return;
        }

        const invoices = await prisma.invoice.findMany({
            where: { id: { in: invoiceIds }, account_id: accountId },
            select: {
                id: true,
                invoice_number: true,
                customer_net_amount: true,
                customer_total_paid: true,
                outstanding_debt: true,
            },
        });

        const candidates = invoices.filter((invoice) =>
            isAbsOverpaidInvoice(
                invoice.customer_total_paid,
                invoice.customer_net_amount,
                paidTolerance
            )
        );

        console.log("[trim-surplus-virtual] scan complete", {
            accountId,
            paidTolerance,
            virtualPayments: virtualPayments.length,
            invoicesWithVirtual: invoices.length,
            overpaidCandidates: candidates.length,
            mode: fix ? "fix" : "dry-run",
        });

        for (const row of candidates.slice(0, 20)) {
            const virt = virtualPayments.find((p) => p.invoice_id === row.id);
            console.log("[trim-surplus-virtual] candidate", {
                invoiceId: row.id,
                invoiceNumber: row.invoice_number,
                customerNet: row.customer_net_amount,
                customerTotalPaid: row.customer_total_paid,
                outstandingDebt: row.outstanding_debt,
                virtualPaymentId: virt?.id ?? null,
                virtualAmount: virt?.customer_amount ?? null,
                virtualReference: virt?.reference ?? null,
            });
        }
        if (candidates.length > 20) {
            console.log("[trim-surplus-virtual] ...", {
                additionalCandidates: candidates.length - 20,
            });
        }

        if (!fix || candidates.length === 0) {
            return;
        }

        const targetIds = candidates.map((row) => row.id);
        const trimResult = await shrinkOrDeleteVirtualPaymentsForInvoiceIds(
            prisma,
            accountId,
            targetIds
        );

        const recalcTargets = new Map<number, Record<string, never>>();
        for (const invoiceId of trimResult.touchedInvoiceIds) {
            recalcTargets.set(invoiceId, {});
        }
        await recalculateInvoicesFromLinkedPayments(prisma, recalcTargets);

        console.log("[trim-surplus-virtual] applied", {
            invoicesTouched: trimResult.touchedInvoiceIds.length,
            virtualsUpdated: trimResult.updatedCount,
            virtualsDeleted: trimResult.deletedCount,
            invoicesRecalculated: recalcTargets.size,
        });
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error("[trim-surplus-virtual] failed", error);
    process.exit(1);
});
