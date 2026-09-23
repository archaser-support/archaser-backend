/**
 * Backfill Invoice.last_payment_date and Invoice.close_date.
 *
 * Rules (grill-me D4/D5/D6/D8):
 * - last_payment_date = MAX(InvoicePayment.payment_date) including virtual
 * - Paid + no payments → both dates = modified_at calendar day
 * - close_date only when status = Paid (else null)
 * - Overwrites existing last_payment_date values
 *
 * Usage:
 *   npx tsx scripts/datafixes/backfill-invoice-close-and-last-payment-dates.ts --dry-run
 *   npx tsx scripts/datafixes/backfill-invoice-close-and-last-payment-dates.ts --fix
 *   npx tsx scripts/datafixes/backfill-invoice-close-and-last-payment-dates.ts --account 10149 --fix
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

import {
    resolveInvoicePaymentCloseDates,
} from "../../packages/billing-connector/src/invoice/invoicePaymentCloseDates";

const LOG = "[backfill-invoice-close-dates]";
const CHUNK = 500;

function parseArgs(argv: string[]): {
    accountId: number | null;
    dryRun: boolean;
    fix: boolean;
} {
    const index = argv.indexOf("--account");
    const raw = index === -1 ? null : argv[index + 1];
    const accountId =
        raw == null ? null : Number.parseInt(raw, 10);
    if (raw != null && (!Number.isInteger(accountId) || accountId! <= 0)) {
        throw new Error("--account <id> must be a positive integer");
    }
    const dryRun = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }
    return { accountId, dryRun, fix };
}

function sameDate(
    a: Date | null | undefined,
    b: Date | null | undefined
): boolean {
    if (a == null && b == null) {
        return true;
    }
    if (a == null || b == null) {
        return false;
    }
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
    const { accountId, fix } = parseArgs(process.argv);
    const prisma = new PrismaClient();
    const mode = fix ? "fix" : "dry-run";

    let scanned = 0;
    let wouldUpdate = 0;
    let updated = 0;
    let cursorId = 0;

    try {
        for (;;) {
            const invoices = await prisma.invoice.findMany({
                where: {
                    id: { gt: cursorId },
                    ...(accountId != null ? { account_id: accountId } : {}),
                },
                orderBy: { id: "asc" },
                take: CHUNK,
                select: {
                    id: true,
                    status: true,
                    modified_at: true,
                    last_payment_date: true,
                    close_date: true,
                },
            });
            if (invoices.length === 0) {
                break;
            }
            cursorId = invoices[invoices.length - 1]!.id;
            scanned += invoices.length;

            const ids = invoices.map((row) => row.id);
            const payments = await prisma.invoicePayment.findMany({
                where: { invoice_id: { in: ids } },
                select: { invoice_id: true, payment_date: true },
            });
            const paymentsByInvoice = new Map<number, Date[]>();
            for (const payment of payments) {
                if (payment.invoice_id == null) {
                    continue;
                }
                const list = paymentsByInvoice.get(payment.invoice_id) ?? [];
                list.push(payment.payment_date);
                paymentsByInvoice.set(payment.invoice_id, list);
            }

            const toWrite: Array<{
                id: number;
                last_payment_date: Date | null;
                close_date: Date | null;
            }> = [];

            for (const invoice of invoices) {
                const dates = resolveInvoicePaymentCloseDates({
                    status: invoice.status,
                    paymentDates: paymentsByInvoice.get(invoice.id) ?? [],
                    modifiedAt: invoice.modified_at,
                });
                if (
                    sameDate(invoice.last_payment_date, dates.last_payment_date) &&
                    sameDate(invoice.close_date, dates.close_date)
                ) {
                    continue;
                }
                toWrite.push({
                    id: invoice.id,
                    last_payment_date: dates.last_payment_date,
                    close_date: dates.close_date,
                });
            }

            wouldUpdate += toWrite.length;
            if (!fix || toWrite.length === 0) {
                continue;
            }

            const writeIds = toWrite.map((row) => row.id);
            const lastDates = toWrite.map((row) => row.last_payment_date);
            const closeDates = toWrite.map((row) => row.close_date);
            const result = await prisma.$executeRaw`
                UPDATE "Invoice" AS inv
                SET
                    last_payment_date = data.last_payment_date,
                    close_date = data.close_date
                FROM (
                    SELECT
                        UNNEST(${writeIds}::int[]) AS id,
                        UNNEST(${lastDates}::date[]) AS last_payment_date,
                        UNNEST(${closeDates}::date[]) AS close_date
                ) AS data
                WHERE inv.id = data.id
            `;
            updated += Number(result);
        }

        console.log(LOG, {
            mode,
            accountId: accountId ?? "all",
            scanned,
            mismatched: wouldUpdate,
            updated: fix ? updated : 0,
        });
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(LOG, "failed", error);
    process.exitCode = 1;
});
