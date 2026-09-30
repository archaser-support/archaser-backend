/**
 * Diagnose why a Paid invoice has close_date but no Mongo BALDATE/FNCDATE.
 *
 * Usage:
 *   npx tsx scripts/diagnose-paid-invoice-mongo-dates.ts --account 10149 --invoice SI260001869
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

import { parseErpDateOnly } from "../packages/billing-connector/src/utils/connectorFieldUtils";
import {
    ensureMongoConnection,
    mongoose,
} from "../packages/billing-connector/src/syncHistory/mongooseConnection";

const LOG = "[diagnose-paid-invoice-mongo-dates]";
const COLLECTION = "connector_import_entity_cache";

function parseArgs(argv: string[]): {
    accountId: number;
    invoiceNumber: string;
} {
    const accountIndex = argv.indexOf("--account");
    const invoiceIndex = argv.indexOf("--invoice");
    const accountId = Number.parseInt(argv[accountIndex + 1] ?? "", 10);
    const invoiceNumber = (argv[invoiceIndex + 1] ?? "").trim();
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new Error("--account <id> is required");
    }
    if (!invoiceNumber) {
        throw new Error("--invoice <number> is required");
    }
    return { accountId, invoiceNumber };
}

function day(value: Date | null | undefined): string | null {
    if (value == null || Number.isNaN(value.getTime())) {
        return null;
    }
    return value.toISOString().slice(0, 10);
}

function asTrimmed(value: unknown): string | null {
    if (value == null || value === "") {
        return null;
    }
    const s = String(value).trim();
    return s.length > 0 ? s : null;
}

function invoiceNumbersFromRow(row: Record<string, unknown>): string[] {
    const raw =
        row._rawRecord && typeof row._rawRecord === "object"
            ? (row._rawRecord as Record<string, unknown>)
            : {};
    const candidates = [
        row.FNCIREF1,
        row.PAY_INVOICE_NUMBER,
        row.invoice_number,
        row.IVNUM,
        raw.FNCIREF1,
        raw.PAY_INVOICE_NUMBER,
        raw.IVNUM,
    ];
    const out = new Set<string>();
    for (const value of candidates) {
        const trimmed = asTrimmed(value);
        if (trimmed) {
            out.add(trimmed);
        }
    }
    return Array.from(out);
}

function fieldDate(
    row: Record<string, unknown>,
    field: string
): string | null {
    const raw =
        row._rawRecord && typeof row._rawRecord === "object"
            ? (row._rawRecord as Record<string, unknown>)
            : {};
    return day(
        parseErpDateOnly(row[field]) ?? parseErpDateOnly(raw[field]) ?? null
    );
}

async function main(): Promise<void> {
    const { accountId, invoiceNumber } = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    const needle = invoiceNumber.toUpperCase();

    try {
        const invoice = await prisma.invoice.findFirst({
            where: {
                account_id: accountId,
                invoice_number: invoiceNumber,
            },
            select: {
                id: true,
                invoice_number: true,
                status: true,
                close_date: true,
                last_payment_date: true,
                amount: true,
                outstanding_debt: true,
                customer_id: true,
                created_at: true,
                modified_at: true,
            },
        });
        console.log(LOG, "postgres_invoice", invoice);

        const payments = await prisma.invoicePayment.findMany({
            where: {
                account_id: accountId,
                invoice_id: invoice?.id,
            },
            select: {
                id: true,
                payment_date: true,
                amount: true,
                reference: true,
                payment_method: true,
                invoice_number: true,
            },
            orderBy: { payment_date: "desc" },
            take: 20,
        });
        console.log(LOG, "postgres_invoice_payments", {
            count: payments.length,
            sample: payments,
        });

        await ensureMongoConnection();
        const collection = mongoose.connection.collection(COLLECTION);

        const paymentHits: Array<Record<string, unknown>> = [];
        const invoiceHits: Array<Record<string, unknown>> = [];
        let paymentDocs = 0;
        let paymentRowsScanned = 0;
        let invoiceDocs = 0;
        let invoiceRowsScanned = 0;

        const paymentCursor = collection.find(
            { account_id: accountId, import_type: "Payment" },
            { projection: { rows: 1, execution_id: 1, cache_day: 1 } }
        );
        for await (const doc of paymentCursor) {
            paymentDocs += 1;
            const rows = Array.isArray(doc.rows) ? doc.rows : [];
            for (const row of rows) {
                if (!row || typeof row !== "object") {
                    continue;
                }
                paymentRowsScanned += 1;
                const record = row as Record<string, unknown>;
                const numbers = invoiceNumbersFromRow(record);
                if (
                    !numbers.some((n) => n.toUpperCase() === needle) &&
                    !JSON.stringify(record).toUpperCase().includes(needle)
                ) {
                    continue;
                }
                if (paymentHits.length < 10) {
                    paymentHits.push({
                        execution_id: doc.execution_id,
                        cache_day: doc.cache_day,
                        linkedInvoiceNumbers: numbers,
                        BALDATE: fieldDate(record, "BALDATE"),
                        FNCDATE: fieldDate(record, "FNCDATE"),
                        RECONDATE: fieldDate(record, "RECONDATE"),
                        FNCIREF1: asTrimmed(record.FNCIREF1),
                        IVNUM: asTrimmed(record.IVNUM),
                        PAY_INVOICE_NUMBER: asTrimmed(
                            record.PAY_INVOICE_NUMBER
                        ),
                        FRECONNUM: asTrimmed(record.FRECONNUM),
                        FNCNUM: asTrimmed(record.FNCNUM),
                        KLINE: asTrimmed(record.KLINE),
                    });
                }
            }
        }

        const invoiceCursor = collection.find(
            { account_id: accountId, import_type: "Invoice" },
            { projection: { rows: 1, execution_id: 1, cache_day: 1 } }
        );
        for await (const doc of invoiceCursor) {
            invoiceDocs += 1;
            const rows = Array.isArray(doc.rows) ? doc.rows : [];
            for (const row of rows) {
                if (!row || typeof row !== "object") {
                    continue;
                }
                invoiceRowsScanned += 1;
                const record = row as Record<string, unknown>;
                const iv =
                    asTrimmed(record.IVNUM) ??
                    asTrimmed(record.invoice_number) ??
                    "";
                if (iv.toUpperCase() !== needle) {
                    const blob = JSON.stringify(record).toUpperCase();
                    if (!blob.includes(needle)) {
                        continue;
                    }
                }
                if (invoiceHits.length < 5) {
                    invoiceHits.push({
                        execution_id: doc.execution_id,
                        cache_day: doc.cache_day,
                        IVNUM: asTrimmed(record.IVNUM),
                        BALDATE: fieldDate(record, "BALDATE"),
                        FNCDATE: fieldDate(record, "FNCDATE"),
                        RECONDATE: fieldDate(record, "RECONDATE"),
                        IVDATE: fieldDate(record, "IVDATE"),
                    });
                }
            }
        }

        console.log(LOG, "mongo_scan", {
            paymentDocs,
            paymentRowsScanned,
            paymentHits: paymentHits.length,
            invoiceDocs,
            invoiceRowsScanned,
            invoiceHits: invoiceHits.length,
        });
        console.log(LOG, "mongo_payment_hits", paymentHits);
        console.log(LOG, "mongo_invoice_hits", invoiceHits);

        // How common is close-only among paid?
        const paidCount = await prisma.invoice.count({
            where: { account_id: accountId, status: "Paid" },
        });
        console.log(LOG, "context", {
            paidCount,
            note: "CSV empty bal/fnc/recon means invoice number was not found on any cached Payment row invoice-link fields",
        });
    } finally {
        await prisma.$disconnect();
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    }
}

main().catch((error) => {
    console.error(LOG, "failed", error);
    process.exitCode = 1;
});
