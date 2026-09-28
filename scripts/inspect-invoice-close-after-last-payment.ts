/**
 * Read-only audit: invoices whose close_date is after the last payment date.
 *
 * Checks two views:
 * 1) Stored columns: close_date > last_payment_date
 * 2) vs payments: close_date > MAX(InvoicePayment.payment_date)
 *
 * Expected rule (Paid): close_date === last_payment_date === max payment day.
 *
 * Usage:
 *   npx tsx scripts/inspect-invoice-close-after-last-payment.ts
 *   npx tsx scripts/inspect-invoice-close-after-last-payment.ts --account 10149
 *   npx tsx scripts/inspect-invoice-close-after-last-payment.ts --account 10149 --sample 20
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const LOG = "[inspect-close-after-last-payment]";

function parseArgs(argv: string[]): {
    accountId: number | null;
    sample: number;
} {
    const index = argv.indexOf("--account");
    const raw = index === -1 ? null : argv[index + 1];
    const accountId =
        raw == null ? null : Number.parseInt(raw, 10);
    if (raw != null && (!Number.isInteger(accountId) || accountId! <= 0)) {
        throw new Error("--account <id> must be a positive integer");
    }
    const sampleIndex = argv.indexOf("--sample");
    const sampleRaw =
        sampleIndex === -1 ? "10" : argv[sampleIndex + 1];
    const sample = Number.parseInt(sampleRaw ?? "10", 10);
    if (!Number.isInteger(sample) || sample < 0) {
        throw new Error("--sample <n> must be a non-negative integer");
    }
    return { accountId, sample };
}

function day(value: Date | null | undefined): string | null {
    if (value == null) {
        return null;
    }
    return value.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
    const { accountId, sample } = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    const accountFilter =
        accountId == null
            ? Prisma.sql``
            : Prisma.sql`AND inv.account_id = ${accountId}`;

    try {
        const storedRows = await prisma.$queryRaw<
            Array<{
                id: number;
                account_id: number;
                invoice_number: string | null;
                status: string;
                close_date: Date;
                last_payment_date: Date;
                days_ahead: number;
            }>
        >`
            SELECT
                inv.id,
                inv.account_id,
                inv.invoice_number,
                inv.status::text AS status,
                inv.close_date,
                inv.last_payment_date,
                (inv.close_date - inv.last_payment_date) AS days_ahead
            FROM "Invoice" AS inv
            WHERE inv.close_date IS NOT NULL
              AND inv.last_payment_date IS NOT NULL
              AND inv.close_date > inv.last_payment_date
              ${accountFilter}
            ORDER BY days_ahead DESC, inv.id ASC
        `;

        const vsPaymentRows = await prisma.$queryRaw<
            Array<{
                id: number;
                account_id: number;
                invoice_number: string | null;
                status: string;
                close_date: Date;
                last_payment_date: Date | null;
                max_payment_date: Date;
                days_ahead: number;
            }>
        >`
            SELECT
                inv.id,
                inv.account_id,
                inv.invoice_number,
                inv.status::text AS status,
                inv.close_date,
                inv.last_payment_date,
                pay.max_payment_date,
                (inv.close_date - pay.max_payment_date) AS days_ahead
            FROM "Invoice" AS inv
            INNER JOIN (
                SELECT
                    invoice_id,
                    MAX(payment_date) AS max_payment_date
                FROM "InvoicePayment"
                WHERE invoice_id IS NOT NULL
                GROUP BY invoice_id
            ) AS pay ON pay.invoice_id = inv.id
            WHERE inv.close_date IS NOT NULL
              AND inv.close_date > pay.max_payment_date
              ${accountFilter}
            ORDER BY days_ahead DESC, inv.id ASC
        `;

        const [totals] = await prisma.$queryRaw<
            Array<{
                total_invoices: bigint;
                with_close_date: bigint;
                paid_with_close_date: bigint;
            }>
        >`
            SELECT
                COUNT(*)::bigint AS total_invoices,
                COUNT(*) FILTER (WHERE close_date IS NOT NULL)::bigint AS with_close_date,
                COUNT(*) FILTER (
                    WHERE status = 'Paid' AND close_date IS NOT NULL
                )::bigint AS paid_with_close_date
            FROM "Invoice" AS inv
            WHERE TRUE
              ${accountFilter}
        `;

        console.log(LOG, "summary", {
            accountId: accountId ?? "all",
            totalInvoices: Number(totals?.total_invoices ?? 0),
            withCloseDate: Number(totals?.with_close_date ?? 0),
            paidWithCloseDate: Number(totals?.paid_with_close_date ?? 0),
            closeAfterStoredLastPayment: storedRows.length,
            closeAfterMaxPaymentDate: vsPaymentRows.length,
        });

        if (sample > 0 && storedRows.length > 0) {
            console.log(
                LOG,
                `sample stored close_date > last_payment_date (up to ${sample}):`
            );
            for (const row of storedRows.slice(0, sample)) {
                console.log({
                    id: row.id,
                    accountId: row.account_id,
                    invoiceNumber: row.invoice_number,
                    status: row.status,
                    closeDate: day(row.close_date),
                    lastPaymentDate: day(row.last_payment_date),
                    daysAhead: Number(row.days_ahead),
                });
            }
        }

        if (sample > 0 && vsPaymentRows.length > 0) {
            console.log(
                LOG,
                `sample close_date > MAX(payment_date) (up to ${sample}):`
            );
            for (const row of vsPaymentRows.slice(0, sample)) {
                console.log({
                    id: row.id,
                    accountId: row.account_id,
                    invoiceNumber: row.invoice_number,
                    status: row.status,
                    closeDate: day(row.close_date),
                    lastPaymentDate: day(row.last_payment_date),
                    maxPaymentDate: day(row.max_payment_date),
                    daysAhead: Number(row.days_ahead),
                });
            }
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(LOG, "failed", error);
    process.exitCode = 1;
});
