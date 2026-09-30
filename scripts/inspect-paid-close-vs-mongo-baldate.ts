/**
 * Compare Paid Invoice.close_date (Postgres) vs BALDATE from Mongo import cache.
 * Also reports MAX(RECONDATE) from the same payment (and invoice) cache rows.
 *
 * Mongo source: connector_import_entity_cache Payment rows (and _rawRecord),
 * keyed by invoice number (FNCIREF1 / PAY_INVOICE_NUMBER / invoice_number / IVNUM).
 * Per invoice: MAX(BALDATE) and MAX(RECONDATE) across cached lines.
 * Invoice-cache RECONDATE fills gaps when payment lines have no RECONDATE.
 *
 * Usage:
 *   npx tsx scripts/inspect-paid-close-vs-mongo-baldate.ts --account 10149
 *   npx tsx scripts/inspect-paid-close-vs-mongo-baldate.ts --account 10149 --sample 20
 *   npx tsx scripts/inspect-paid-close-vs-mongo-baldate.ts --account 10149 --csv /tmp/out.csv
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
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
    csvPath: string | null;
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
    const csvIndex = argv.indexOf("--csv");
    const csvPath =
        csvIndex === -1 ? null : (argv[csvIndex + 1]?.trim() || null);
    if (csvIndex !== -1 && !csvPath) {
        throw new Error("--csv <path> requires a file path");
    }
    return { accountId, sample, csvPath };
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

function invoiceNumberFromInvoiceRow(
    row: Record<string, unknown>
): string | null {
    const raw =
        row._rawRecord && typeof row._rawRecord === "object"
            ? (row._rawRecord as Record<string, unknown>)
            : {};
    return (
        asTrimmed(row.IVNUM) ??
        asTrimmed(row.invoice_number) ??
        asTrimmed(raw.IVNUM) ??
        asTrimmed(raw.invoice_number)
    );
}

function fieldDateFromRow(
    row: Record<string, unknown>,
    field: "BALDATE" | "RECONDATE"
): Date | null {
    const raw =
        row._rawRecord && typeof row._rawRecord === "object"
            ? (row._rawRecord as Record<string, unknown>)
            : {};
    return (
        parseErpDateOnly(row[field]) ??
        parseErpDateOnly(raw[field]) ??
        null
    );
}

function setMaxDate(
    map: Map<string, Date>,
    invoiceNumber: string,
    value: Date | null
): void {
    if (!value) {
        return;
    }
    const existing = map.get(invoiceNumber);
    if (!existing || value > existing) {
        map.set(invoiceNumber, value);
    }
}

async function loadMongoDatesByInvoice(accountId: number): Promise<{
    balByInvoice: Map<string, Date>;
    reconByInvoice: Map<string, Date>;
    paymentDocs: number;
    paymentRows: number;
    rowsWithBalDate: number;
    rowsWithReconDate: number;
    invoiceDocs: number;
    invoiceRowsWithReconDate: number;
}> {
    await ensureMongoConnection();
    const collection = mongoose.connection.collection(COLLECTION);

    const balByInvoice = new Map<string, Date>();
    const reconByInvoice = new Map<string, Date>();
    let paymentDocs = 0;
    let paymentRows = 0;
    let rowsWithBalDate = 0;
    let rowsWithReconDate = 0;
    let invoiceDocs = 0;
    let invoiceRowsWithReconDate = 0;

    const paymentCursor = collection.find(
        {
            account_id: accountId,
            import_type: "Payment",
        },
        {
            projection: {
                rows: 1,
            },
        }
    );

    for await (const doc of paymentCursor) {
        paymentDocs += 1;
        const rows = Array.isArray(doc.rows) ? doc.rows : [];
        for (const row of rows) {
            if (!row || typeof row !== "object") {
                continue;
            }
            paymentRows += 1;
            const record = row as Record<string, unknown>;
            const balDate = fieldDateFromRow(record, "BALDATE");
            const reconDate = fieldDateFromRow(record, "RECONDATE");
            if (balDate) {
                rowsWithBalDate += 1;
            }
            if (reconDate) {
                rowsWithReconDate += 1;
            }
            if (!balDate && !reconDate) {
                continue;
            }
            for (const invoiceNumber of invoiceNumbersFromPaymentRow(record)) {
                setMaxDate(balByInvoice, invoiceNumber, balDate);
                setMaxDate(reconByInvoice, invoiceNumber, reconDate);
            }
        }
    }

    const invoiceCursor = collection.find(
        {
            account_id: accountId,
            import_type: "Invoice",
        },
        {
            projection: {
                rows: 1,
            },
        }
    );

    for await (const doc of invoiceCursor) {
        invoiceDocs += 1;
        const rows = Array.isArray(doc.rows) ? doc.rows : [];
        for (const row of rows) {
            if (!row || typeof row !== "object") {
                continue;
            }
            const record = row as Record<string, unknown>;
            const invoiceNumber = invoiceNumberFromInvoiceRow(record);
            if (!invoiceNumber) {
                continue;
            }
            const reconDate = fieldDateFromRow(record, "RECONDATE");
            if (!reconDate) {
                continue;
            }
            invoiceRowsWithReconDate += 1;
            setMaxDate(reconByInvoice, invoiceNumber, reconDate);
        }
    }

    return {
        balByInvoice,
        reconByInvoice,
        paymentDocs,
        paymentRows,
        rowsWithBalDate,
        rowsWithReconDate,
        invoiceDocs,
        invoiceRowsWithReconDate,
    };
}

function csvEscape(value: string): string {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

async function main(): Promise<void> {
    const { accountId, sample, csvPath } = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        const mongo = await loadMongoDatesByInvoice(accountId);
        console.log(LOG, "mongo cache", {
            accountId,
            paymentDocs: mongo.paymentDocs,
            paymentRows: mongo.paymentRows,
            rowsWithBalDate: mongo.rowsWithBalDate,
            rowsWithReconDate: mongo.rowsWithReconDate,
            distinctInvoiceNumbersWithBalDate: mongo.balByInvoice.size,
            distinctInvoiceNumbersWithReconDate: mongo.reconByInvoice.size,
            invoiceDocs: mongo.invoiceDocs,
            invoiceRowsWithReconDate: mongo.invoiceRowsWithReconDate,
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
            closeDate: string;
            balDate: string;
            reconDate: string | null;
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

                const balDate = mongo.balByInvoice.get(invoiceNumber);
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
                    reconDate: day(mongo.reconByInvoice.get(invoiceNumber)),
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
            diffsWithReconDate: diffs.filter((row) => row.reconDate != null)
                .length,
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

        if (csvPath) {
            const header =
                "id,invoice_number,close_date,baldate,recondate,days_diff";
            const body = diffs.map((row) =>
                [
                    String(row.id),
                    csvEscape(row.invoiceNumber),
                    row.closeDate,
                    row.balDate,
                    row.reconDate ?? "",
                    String(row.daysDiff),
                ].join(",")
            );
            writeFileSync(csvPath, [header, ...body].join("\n") + "\n", "utf8");
            console.log(LOG, "wrote csv", { path: csvPath, rows: diffs.length });
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
