/**
 * Compare Paid Invoice.close_date (Postgres) vs BALDATE from Mongo import cache.
 *
 * Mongo source: connector_import_entity_cache Payment rows (and _rawRecord),
 * keyed by invoice number (FNCIREF1 / PAY_INVOICE_NUMBER / invoice_number / IVNUM).
 * Per invoice: MAX(BALDATE) across cached payment lines.
 *
 * Usage:
 *   npx tsx scripts/inspect-paid-close-vs-mongo-baldate.ts --account 10149
 *   npx tsx scripts/inspect-paid-close-vs-mongo-baldate.ts --account 10149 --sample 20
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

import { parseErpDateOnly } from "../packages/billing-connector/src/utils/connectorFieldUtils";
import {
    ensureMongoConnection,
    mongoose,
} from "../packages/billing-connector/src/syncHistory/mongooseConnection";

const LOG = "[inspect-paid-close-vs-mongo-baldate]";
const COLLECTION = "connector_import_entity_cache";
const CHUNK = 2000;

function parseArgs(argv: string[]): {
    accountId: number;
    sample: number;
} {
    const index = argv.indexOf("--account");
    const raw = index === -1 ? null : argv[index + 1];
    const accountId = Number.parseInt(raw ?? "", 10);
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new Error("--account <id> is required");
    }
    const sampleIndex = argv.indexOf("--sample");
    const sample = Number.parseInt(
        sampleIndex === -1 ? "15" : (argv[sampleIndex + 1] ?? "15"),
        10
    );
    if (!Number.isInteger(sample) || sample < 0) {
        throw new Error("--sample <n> must be a non-negative integer");
    }
    return { accountId, sample };
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

function invoiceNumbersFromPaymentRow(
    row: Record<string, unknown>
): string[] {
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

function balDateFromPaymentRow(
    row: Record<string, unknown>
): Date | null {
    const raw =
        row._rawRecord && typeof row._rawRecord === "object"
            ? (row._rawRecord as Record<string, unknown>)
            : {};
    return (
        parseErpDateOnly(row.BALDATE) ??
        parseErpDateOnly(raw.BALDATE) ??
        null
    );
}

async function loadMaxBalDateByInvoice(
    accountId: number
): Promise<{
    byInvoice: Map<string, Date>;
    paymentDocs: number;
    paymentRows: number;
    rowsWithBalDate: number;
}> {
    await ensureMongoConnection();
    const collection = mongoose.connection.collection(COLLECTION);
    const cursor = collection.find(
        {
            account_id: accountId,
            import_type: "Payment",
        },
        {
            projection: {
                rows: 1,
                execution_id: 1,
                cache_day: 1,
                chunk_index: 1,
            },
        }
    );

    const byInvoice = new Map<string, Date>();
    let paymentDocs = 0;
    let paymentRows = 0;
    let rowsWithBalDate = 0;

    for await (const doc of cursor) {
        paymentDocs += 1;
        const rows = Array.isArray(doc.rows) ? doc.rows : [];
        for (const row of rows) {
            if (!row || typeof row !== "object") {
                continue;
            }
            paymentRows += 1;
            const record = row as Record<string, unknown>;
            const balDate = balDateFromPaymentRow(record);
            if (!balDate) {
                continue;
            }
            rowsWithBalDate += 1;
            for (const invoiceNumber of invoiceNumbersFromPaymentRow(record)) {
                const existing = byInvoice.get(invoiceNumber);
                if (!existing || balDate > existing) {
                    byInvoice.set(invoiceNumber, balDate);
                }
            }
        }
    }

    return { byInvoice, paymentDocs, paymentRows, rowsWithBalDate };
}

async function main(): Promise<void> {
    const { accountId, sample } = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        const mongo = await loadMaxBalDateByInvoice(accountId);
        console.log(LOG, "mongo payment cache", {
            accountId,
            paymentDocs: mongo.paymentDocs,
            paymentRows: mongo.paymentRows,
            rowsWithBalDate: mongo.rowsWithBalDate,
            distinctInvoiceNumbersWithBalDate: mongo.byInvoice.size,
        });

        let scanned = 0;
        let withCloseDate = 0;
        let matchedInMongo = 0;
        let sameDate = 0;
        let different = 0;
        let closeAfterBal = 0;
        let closeBeforeBal = 0;
        let noCloseDate = 0;
        let cursorId = 0;

        type DiffRow = {
            id: number;
            invoiceNumber: string;
            closeDate: string | null;
            balDate: string;
            daysDiff: number;
        };
        const diffs: DiffRow[] = [];

        for (;;) {
            const invoices = await prisma.invoice.findMany({
                where: {
                    account_id: accountId,
                    status: "Paid",
                    id: { gt: cursorId },
                },
                orderBy: { id: "asc" },
                take: CHUNK,
                select: {
                    id: true,
                    invoice_number: true,
                    close_date: true,
                    last_payment_date: true,
                },
            });
            if (invoices.length === 0) {
                break;
            }
            cursorId = invoices[invoices.length - 1]!.id;
            scanned += invoices.length;

            for (const invoice of invoices) {
                const invoiceNumber = invoice.invoice_number?.trim() ?? "";
                if (!invoiceNumber) {
                    continue;
                }
                if (invoice.close_date == null) {
                    noCloseDate += 1;
                    continue;
                }
                withCloseDate += 1;

                const balDate = mongo.byInvoice.get(invoiceNumber);
                if (!balDate) {
                    continue;
                }
                matchedInMongo += 1;

                const closeDay = day(invoice.close_date)!;
                const balDay = day(balDate)!;
                if (closeDay === balDay) {
                    sameDate += 1;
                    continue;
                }

                different += 1;
                const daysDiff =
                    (Date.parse(`${closeDay}T00:00:00.000Z`) -
                        Date.parse(`${balDay}T00:00:00.000Z`)) /
                    86_400_000;
                if (daysDiff > 0) {
                    closeAfterBal += 1;
                } else {
                    closeBeforeBal += 1;
                }
                diffs.push({
                    id: invoice.id,
                    invoiceNumber,
                    closeDate: closeDay,
                    balDate: balDay,
                    daysDiff,
                });
            }
        }

        diffs.sort(
            (a, b) => Math.abs(b.daysDiff) - Math.abs(a.daysDiff)
        );

        console.log(LOG, "summary", {
            accountId,
            paidScanned: scanned,
            paidWithCloseDate: withCloseDate,
            paidNoCloseDate: noCloseDate,
            paidMatchedInMongoBalDate: matchedInMongo,
            closeEqualsBalDate: sameDate,
            closeDiffersFromBalDate: different,
            closeAfterBalDate: closeAfterBal,
            closeBeforeBalDate: closeBeforeBal,
            unpaidCoverageNote:
                "Only invoices present in Mongo Payment cache (TTL-limited) are compared",
        });

        if (sample > 0 && diffs.length > 0) {
            console.log(
                LOG,
                `sample close_date ≠ BALDATE (up to ${sample}, largest |daysDiff| first):`
            );
            for (const row of diffs.slice(0, sample)) {
                console.log(row);
            }
        }
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
