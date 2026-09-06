/**
 * Realign payments stored in the invoice's base currency.
 *
 * Priority receipt lines (IDG_ARFNCITEMS4) carry only the base/company currency,
 * so receipts against foreign-currency invoices were stored with the base figure
 * in both `amount` and `customer_amount` — over-crediting the invoice. Recompute
 * `customer_amount` from the FX ratio embedded in the invoice and recalc totals.
 *
 * Requires the invoice to carry a real ratio (amount != customer_amount); rows
 * whose invoice still has ratio 1 are reported as skipped, not modified.
 *
 * Usage:
 *   npx tsx scripts/datafixes/realign-payments-to-invoice-currency.ts --account 10149 --dry-run
 *   npx tsx scripts/datafixes/realign-payments-to-invoice-currency.ts --account 10149 --fix
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

import { resolveAccountBillingExtension } from "../../packages/billing-connector/src/extensions";
import { alignPaymentToInvoiceCurrency } from "../../packages/billing-connector/src/payment/alignPaymentToInvoiceCurrency";
import { recalculateInvoicesFromLinkedPayments } from "../../packages/billing-connector/src/invoice/linkDeferredPaymentAndRecalc";

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
        const extension = await resolveAccountBillingExtension(
            prisma,
            accountId
        );
        const currencyOptions = extension?.normalizePaymentCurrency
            ? { normalizeCurrency: extension.normalizePaymentCurrency }
            : undefined;

        const payments = await prisma.invoicePayment.findMany({
            where: { account_id: accountId, invoice_id: { not: null } },
            select: {
                id: true,
                reference: true,
                amount: true,
                customer_amount: true,
                customer_currency: true,
                Invoice: {
                    select: {
                        id: true,
                        invoice_number: true,
                        amount: true,
                        customer_amount: true,
                        customer_currency: true,
                    },
                },
            },
        });

        const fixes: Array<{
            id: number;
            invoiceId: number;
            reference: string;
            invoiceNumber: string | null;
            fromAmount: number | null;
            fromCurrency: string | null;
            toAmount: number;
            toCurrency: string;
        }> = [];
        let skippedNoRatio = 0;

        for (const payment of payments) {
            const invoice = payment.Invoice;
            if (!invoice) continue;

            const alignment = alignPaymentToInvoiceCurrency(
                payment,
                invoice,
                currencyOptions
            );
            if (alignment) {
                fixes.push({
                    id: payment.id,
                    invoiceId: invoice.id,
                    reference: payment.reference,
                    invoiceNumber: invoice.invoice_number,
                    fromAmount: payment.customer_amount,
                    fromCurrency: payment.customer_currency,
                    toAmount: alignment.customer_amount,
                    toCurrency: alignment.customer_currency,
                });
                continue;
            }

            // Currency differs but the invoice carries no usable ratio.
            const paymentCurrency = (payment.customer_currency ?? "")
                .trim()
                .toUpperCase();
            const invoiceCurrency = (invoice.customer_currency ?? "")
                .trim()
                .toUpperCase();
            if (
                paymentCurrency &&
                invoiceCurrency &&
                paymentCurrency !== invoiceCurrency
            ) {
                skippedNoRatio += 1;
            }
        }

        console.log("[realign-payments] scan complete", {
            accountId,
            paymentsScanned: payments.length,
            needingRealignment: fixes.length,
            skippedNoInvoiceRatio: skippedNoRatio,
            mode: fix ? "fix" : "dry-run",
        });

        for (const row of fixes.slice(0, 20)) {
            console.log("[realign-payments] candidate", {
                paymentId: row.id,
                reference: row.reference,
                invoiceNumber: row.invoiceNumber,
                fromCustomerAmount: row.fromAmount,
                fromCurrency: row.fromCurrency,
                toCustomerAmount: row.toAmount,
                toCurrency: row.toCurrency,
            });
        }
        if (fixes.length > 20) {
            console.log("[realign-payments] ...", {
                additionalCandidates: fixes.length - 20,
            });
        }

        if (!fix || fixes.length === 0) {
            return;
        }

        for (const row of fixes) {
            await prisma.invoicePayment.update({
                where: { id: row.id },
                data: {
                    customer_amount: row.toAmount,
                    customer_currency: row.toCurrency,
                    modified_at: new Date(),
                },
                select: { id: true },
            });
        }

        const invoiceIds = new Map<number, Record<string, never>>();
        for (const row of fixes) {
            invoiceIds.set(row.invoiceId, {});
        }
        await recalculateInvoicesFromLinkedPayments(prisma, invoiceIds);

        console.log("[realign-payments] applied", {
            paymentsUpdated: fixes.length,
            invoicesRecalculated: invoiceIds.size,
        });
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error("[realign-payments] failed", error);
    process.exit(1);
});
