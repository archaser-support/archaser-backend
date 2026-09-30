/**
 * Account paid-invoice totals + BALDATE vs FNCDATE from Mongo payment cache.
 *
 * Usage:
 *   npx tsx scripts/inspect-paid-baldate-vs-fncdate.ts --account 10149
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

import { parseErpDateOnly } from "../packages/billing-connector/src/utils/connectorFieldUtils";
import {
    ensureMongoConnection,
    mongoose,
} from "../packages/billing-connector/src/syncHistory/mongooseConnection";

const LOG = "[inspect-paid-baldate-vs-fncdate]";
const COLLECTION = "connector_import_entity_cache";

function parseArgs(argv: string[]): { accountId: number } {
    const index = argv.indexOf("--account");
    const raw = index === -1 ? null : argv[index + 1];
    const accountId = Number.parseInt(raw ?? "", 10);
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new Error("--account <id> is required");
    }
    return { accountId };
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

function invoiceNumbersFromPaymentRow(row: Record<string, unknown>): string[] {
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
    field: "BALDATE" | "FNCDATE" | "RECONDATE"
): Date | null {
    const raw =
        row._rawRecord && typeof row._rawRecord === "object"
            ? (row._rawRecord as Record<string, unknown>)
            : {};
    return (
        parseErpDateOnly(row[field]) ?? parseErpDateOnly(raw[field]) ?? null
    );
}

function setMax(map: Map<string, Date>, key: string, value: Date | null): void {
    if (!value) {
        return;
    }
    const existing = map.get(key);
    if (!existing || value > existing) {
        map.set(key, value);
    }
}

async function main(): Promise<void> {
    const { accountId } = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        const [paidTotal, invoiceTotal] = await Promise.all([
            prisma.invoice.count({
                where: { account_id: accountId, status: "Paid" },
            }),
            prisma.invoice.count({
                where: { account_id: accountId },
            }),
        ]);

        await ensureMongoConnection();
        const collection = mongoose.connection.collection(COLLECTION);
        const cursor = collection.find(
            { account_id: accountId, import_type: "Payment" },
            { projection: { rows: 1 } }
        );

        const balByInvoice = new Map<string, Date>();
        const fncByInvoice = new Map<string, Date>();
        const reconByInvoice = new Map<string, Date>();

        let paymentRows = 0;
        let rowsWithBal = 0;
        let rowsWithFnc = 0;
        let rowsWithBoth = 0;
        let rowsBalEqFnc = 0;
        let rowsBalNeFnc = 0;

        for await (const doc of cursor) {
            const rows = Array.isArray(doc.rows) ? doc.rows : [];
            for (const row of rows) {
                if (!row || typeof row !== "object") {
                    continue;
                }
                paymentRows += 1;
                const record = row as Record<string, unknown>;
                const bal = fieldDate(record, "BALDATE");
                const fnc = fieldDate(record, "FNCDATE");
                const recon = fieldDate(record, "RECONDATE");
                if (bal) {
                    rowsWithBal += 1;
                }
                if (fnc) {
                    rowsWithFnc += 1;
                }
                if (bal && fnc) {
                    rowsWithBoth += 1;
                    const balDay = day(bal)!;
                    const fncDay = day(fnc)!;
                    if (balDay === fncDay) {
                        rowsBalEqFnc += 1;
                    } else {
                        rowsBalNeFnc += 1;
                    }
                }
                for (const invoiceNumber of invoiceNumbersFromPaymentRow(
                    record
                )) {
                    setMax(balByInvoice, invoiceNumber, bal);
                    setMax(fncByInvoice, invoiceNumber, fnc);
                    setMax(reconByInvoice, invoiceNumber, recon);
                }
            }
        }

        const paidInvoices = await prisma.invoice.findMany({
            where: { account_id: accountId, status: "Paid" },
            select: {
                id: true,
                invoice_number: true,
                close_date: true,
            },
        });

        let paidWithBal = 0;
        let paidCloseEqBal = 0;
        let paidCloseNeBal = 0;
        let paidNoBal = 0;
        let paidWithBalAndFnc = 0;
        let paidBalEqFnc = 0;
        let paidBalNeFnc = 0;
        let paidBalNoFnc = 0;
        let paidCloseEqFnc = 0;
        let paidCloseNeFnc = 0;

        for (const invoice of paidInvoices) {
            const invoiceNumber = invoice.invoice_number?.trim() ?? "";
            if (!invoiceNumber) {
                continue;
            }
            const bal = balByInvoice.get(invoiceNumber);
            const fnc = fncByInvoice.get(invoiceNumber);
            if (!bal) {
                paidNoBal += 1;
                continue;
            }
            paidWithBal += 1;
            const closeDay = day(invoice.close_date);
            const balDay = day(bal)!;
            if (closeDay === balDay) {
                paidCloseEqBal += 1;
            } else if (closeDay) {
                paidCloseNeBal += 1;
            }

            if (!fnc) {
                paidBalNoFnc += 1;
                continue;
            }
            paidWithBalAndFnc += 1;
            const fncDay = day(fnc)!;
            if (balDay === fncDay) {
                paidBalEqFnc += 1;
            } else {
                paidBalNeFnc += 1;
            }
            if (closeDay === fncDay) {
                paidCloseEqFnc += 1;
            } else if (closeDay) {
                paidCloseNeFnc += 1;
            }
        }

        console.log(LOG, "totals", {
            accountId,
            invoicesAllStatuses: invoiceTotal,
            invoicesPaid: paidTotal,
            paidWithMongoBalDate: paidWithBal,
            paidWithoutMongoBalDate: paidNoBal,
            paidCloseEqualsBalDate: paidCloseEqBal,
            paidCloseDiffersFromBalDate: paidCloseNeBal,
        });
        console.log(LOG, "payment_rows_baldate_vs_fncdate", {
            paymentRows,
            rowsWithBalDate: rowsWithBal,
            rowsWithFncDate: rowsWithFnc,
            rowsWithBoth: rowsWithBoth,
            rowsBaldateEqualsFncdate: rowsBalEqFnc,
            rowsBaldateDiffersFromFncdate: rowsBalNeFnc,
        });
        console.log(LOG, "paid_invoices_baldate_vs_fncdate", {
            paidWithBalAndFnc,
            paidBaldateEqualsFncdate: paidBalEqFnc,
            paidBaldateDiffersFromFncdate: paidBalNeFnc,
            paidWithBalButNoFnc: paidBalNoFnc,
            paidCloseEqualsFncdate: paidCloseEqFnc,
            paidCloseDiffersFromFncdate: paidCloseNeFnc,
            distinctInvoiceNumbersWithBal: balByInvoice.size,
            distinctInvoiceNumbersWithFnc: fncByInvoice.size,
            distinctInvoiceNumbersWithRecon: reconByInvoice.size,
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
