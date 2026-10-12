/**
 * Export Paid invoices with Mongo BALDATE / FNCDATE / RECONDATE vs close_date.
 *
 * Usage:
 *   npx tsx scripts/export-paid-close-vs-erp-dates.ts --account 10149 --csv /tmp/out.csv
 *   npx tsx scripts/export-paid-close-vs-erp-dates.ts --account 10149 --csv /tmp/out.csv --all-paid
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

import { parseErpDateOnly } from "../packages/billing-connector/src/utils/connectorFieldUtils";
import {
    ensureMongoConnection,
    mongoose,
} from "../packages/billing-connector/src/syncHistory/mongooseConnection";

const LOG = "[export-paid-close-vs-erp-dates]";
const COLLECTION = "connector_import_entity_cache";
const CHUNK = 2000;

function parseArgs(argv: string[]): {
    accountId: number;
    csvPath: string;
    allPaid: boolean;
} {
    const index = argv.indexOf("--account");
    const raw = index === -1 ? null : argv[index + 1];
    const accountId = Number.parseInt(raw ?? "", 10);
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new Error("--account <id> is required");
    }
    const csvIndex = argv.indexOf("--csv");
    const csvPath = csvIndex === -1 ? null : (argv[csvIndex + 1]?.trim() || null);
    if (!csvPath) {
        throw new Error("--csv <path> is required");
    }
    const allPaid = argv.includes("--all-paid");
    return { accountId, csvPath, allPaid };
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

function csvEscape(value: string): string {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

function daysBetween(a: string | null, b: string | null): string {
    if (!a || !b) {
        return "";
    }
    return String(
        (Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`)) /
            86_400_000
    );
}

async function main(): Promise<void> {
    const { accountId, csvPath, allPaid } = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
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
                for (const invoiceNumber of invoiceNumbersFromPaymentRow(
                    record
                )) {
                    setMax(balByInvoice, invoiceNumber, bal);
                    setMax(fncByInvoice, invoiceNumber, fnc);
                    setMax(reconByInvoice, invoiceNumber, recon);
                }
            }
        }

        type OutRow = {
            id: number;
            invoiceNumber: string;
            customerNumber: string;
            amount: string;
            totalPaid: string;
            outstandingDebt: string;
            customerAmount: string;
            customerOutstandingDebt: string;
            closeDate: string | null;
            balDate: string | null;
            fncDate: string | null;
            reconDate: string | null;
            closeEqBal: string;
            closeEqFnc: string;
            balEqFnc: string;
            balEqRecon: string;
            closeMinusBalDays: string;
            closeMinusFncDays: string;
            balMinusFncDays: string;
        };

        const out: OutRow[] = [];
        let cursorId = 0;
        let paidScanned = 0;
        let included = 0;
        let skippedNoMongo = 0;

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
                    customer_number: true,
                    amount: true,
                    total_paid: true,
                    outstanding_debt: true,
                    customer_amount: true,
                    customer_outstanding_debt: true,
                    Customer: {
                        select: { customer_number: true },
                    },
                },
            });
            if (invoices.length === 0) {
                break;
            }
            cursorId = invoices[invoices.length - 1]!.id;
            paidScanned += invoices.length;

            for (const invoice of invoices) {
                const invoiceNumber = invoice.invoice_number?.trim() ?? "";
                if (!invoiceNumber) {
                    continue;
                }
                const bal = balByInvoice.get(invoiceNumber);
                const fnc = fncByInvoice.get(invoiceNumber);
                const recon = reconByInvoice.get(invoiceNumber);
                if (!allPaid && !bal && !fnc && !recon) {
                    skippedNoMongo += 1;
                    continue;
                }
                if (!allPaid && !bal) {
                    skippedNoMongo += 1;
                    continue;
                }

                const closeDate = day(invoice.close_date);
                const balDate = day(bal);
                const fncDate = day(fnc);
                const reconDate = day(recon);
                const customerNumber =
                    invoice.Customer?.customer_number?.trim() ||
                    (invoice.customer_number != null
                        ? String(invoice.customer_number)
                        : "");
                included += 1;
                out.push({
                    id: invoice.id,
                    invoiceNumber,
                    customerNumber,
                    amount:
                        invoice.amount != null ? String(invoice.amount) : "",
                    totalPaid:
                        invoice.total_paid != null
                            ? String(invoice.total_paid)
                            : "",
                    outstandingDebt:
                        invoice.outstanding_debt != null
                            ? String(invoice.outstanding_debt)
                            : "",
                    customerAmount:
                        invoice.customer_amount != null
                            ? String(invoice.customer_amount)
                            : "",
                    customerOutstandingDebt:
                        invoice.customer_outstanding_debt != null
                            ? String(invoice.customer_outstanding_debt)
                            : "",
                    closeDate,
                    balDate,
                    fncDate,
                    reconDate,
                    closeEqBal:
                        closeDate && balDate
                            ? closeDate === balDate
                                ? "Y"
                                : "N"
                            : "",
                    closeEqFnc:
                        closeDate && fncDate
                            ? closeDate === fncDate
                                ? "Y"
                                : "N"
                            : "",
                    balEqFnc:
                        balDate && fncDate
                            ? balDate === fncDate
                                ? "Y"
                                : "N"
                            : "",
                    balEqRecon:
                        balDate && reconDate
                            ? balDate === reconDate
                                ? "Y"
                                : "N"
                            : "",
                    closeMinusBalDays: daysBetween(closeDate, balDate),
                    closeMinusFncDays: daysBetween(closeDate, fncDate),
                    balMinusFncDays: daysBetween(balDate, fncDate),
                });
            }
        }

        out.sort((a, b) => {
            const ad = Math.abs(Number(a.closeMinusBalDays || 0));
            const bd = Math.abs(Number(b.closeMinusBalDays || 0));
            return bd - ad || a.id - b.id;
        });

        const header = [
            "id",
            "invoice_number",
            "customer_number",
            "amount",
            "total_paid",
            "outstanding_debt",
            "customer_amount",
            "customer_outstanding_debt",
            "close_date",
            "baldate",
            "fncdate",
            "recondate",
            "close_eq_baldate",
            "close_eq_fncdate",
            "baldate_eq_fncdate",
            "baldate_eq_recondate",
            "close_minus_bal_days",
            "close_minus_fnc_days",
            "bal_minus_fnc_days",
        ].join(",");

        const body = out.map((row) =>
            [
                String(row.id),
                csvEscape(row.invoiceNumber),
                csvEscape(row.customerNumber),
                row.amount,
                row.totalPaid,
                row.outstandingDebt,
                row.customerAmount,
                row.customerOutstandingDebt,
                row.closeDate ?? "",
                row.balDate ?? "",
                row.fncDate ?? "",
                row.reconDate ?? "",
                row.closeEqBal,
                row.closeEqFnc,
                row.balEqFnc,
                row.balEqRecon,
                row.closeMinusBalDays,
                row.closeMinusFncDays,
                row.balMinusFncDays,
            ].join(",")
        );

        writeFileSync(csvPath, [header, ...body].join("\n") + "\n", "utf8");

        const balEqFnc = out.filter((r) => r.balEqFnc === "Y").length;
        const balNeFnc = out.filter((r) => r.balEqFnc === "N").length;
        const closeNeBal = out.filter((r) => r.closeEqBal === "N").length;
        const closeEqFnc = out.filter((r) => r.closeEqFnc === "Y").length;

        console.log(LOG, "summary", {
            accountId,
            paymentRows,
            paidScanned,
            rowsWritten: out.length,
            skippedNoMongoBaldate: skippedNoMongo,
            allPaid,
            baldateEqualsFncdate: balEqFnc,
            baldateDiffersFromFncdate: balNeFnc,
            closeDiffersFromBaldate: closeNeBal,
            closeEqualsFncdate: closeEqFnc,
            csvPath,
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
