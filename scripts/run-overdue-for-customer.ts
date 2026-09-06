/**
 * Run the "Process Overdue Invoices" cron job scoped to one customer, while
 * holding MEP / reporting fields steady.
 *
 * handleOverdueInvoices has no flag to skip its MEP work: it sweeps
 * reporting_breach and, when overdue_block flips, recomputes
 * ctv_customer_overdue_mep / target_mep_date / target_reporting_date.
 * So the MEP columns are snapshotted before the run and rewritten after it,
 * and every drift is reported.
 *
 * Usage:
 *   npx tsx scripts/run-overdue-for-customer.ts --customer 4036
 *   npx tsx scripts/run-overdue-for-customer.ts --customer 4036 --allow-mep-change
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

import { handleOverdueInvoices } from "../packages/cron-jobs/src/handleOverdueInvoices";

const MEP_FIELDS = [
    "target_mep_date",
    "ctv_customer_overdue_mep",
    "reporting_breach",
    "target_reporting_date",
    "ctv_payment_term",
] as const;

type MepField = (typeof MEP_FIELDS)[number];
type MepSnapshot = Record<number, Record<MepField, unknown>>;

function parseArgs(argv: string[]): { customerId: number; restore: boolean } {
    const index = argv.indexOf("--customer");
    const customerId = Number(index === -1 ? NaN : argv[index + 1]);
    if (!Number.isInteger(customerId) || customerId <= 0) {
        throw new Error("--customer <id> is required");
    }
    return { customerId, restore: !argv.includes("--allow-mep-change") };
}

async function snapshotMep(
    prisma: PrismaClient,
    customerId: number
): Promise<MepSnapshot> {
    const rows = await prisma.invoice.findMany({
        where: { customer_id: customerId },
        select: {
            id: true,
            target_mep_date: true,
            ctv_customer_overdue_mep: true,
            reporting_breach: true,
            target_reporting_date: true,
            ctv_payment_term: true,
        },
    });
    const snapshot: MepSnapshot = {};
    for (const row of rows) {
        const { id, ...fields } = row;
        snapshot[id] = fields as Record<MepField, unknown>;
    }
    return snapshot;
}

function sameValue(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }
    return a === b;
}

async function main(): Promise<void> {
    const { customerId, restore } = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        const before = await snapshotMep(prisma, customerId);
        const dueBefore = await prisma.invoice.groupBy({
            by: ["status"],
            where: { customer_id: customerId },
            _count: { _all: true },
        });
        console.log("[overdue] status before:", JSON.stringify(dueBefore));
        console.log("[overdue] MEP snapshot rows:", Object.keys(before).length);

        const result = await handleOverdueInvoices(prisma, customerId);
        console.log("[overdue] job result:", {
            success: result.success,
            message: result.message,
            durationMs: result.durationMs,
            summary: JSON.stringify(result.summary),
        });

        const after = await snapshotMep(prisma, customerId);
        const drifted: Array<{
            invoiceId: number;
            field: MepField;
            before: unknown;
            after: unknown;
        }> = [];
        for (const [idRaw, afterFields] of Object.entries(after)) {
            const invoiceId = Number(idRaw);
            const beforeFields = before[invoiceId];
            if (!beforeFields) {
                continue;
            }
            for (const field of MEP_FIELDS) {
                if (!sameValue(beforeFields[field], afterFields[field])) {
                    drifted.push({
                        invoiceId,
                        field,
                        before: beforeFields[field],
                        after: afterFields[field],
                    });
                }
            }
        }

        console.log("[overdue] MEP drift count:", drifted.length);
        for (const change of drifted) {
            console.log("[overdue] MEP drift:", {
                invoiceId: change.invoiceId,
                field: change.field,
                before: String(change.before),
                after: String(change.after),
            });
        }

        if (drifted.length > 0 && restore) {
            const byInvoice = new Map<number, Partial<Record<MepField, unknown>>>();
            for (const change of drifted) {
                const entry = byInvoice.get(change.invoiceId) ?? {};
                entry[change.field] = change.before;
                byInvoice.set(change.invoiceId, entry);
            }
            for (const [invoiceId, data] of byInvoice) {
                await prisma.invoice.update({
                    where: { id: invoiceId },
                    data: data as never,
                });
            }
            console.log(
                "[overdue] restored MEP fields on",
                byInvoice.size,
                "invoice(s)"
            );
        }

        const dueAfter = await prisma.invoice.groupBy({
            by: ["status"],
            where: { customer_id: customerId },
            _count: { _all: true },
        });
        console.log("[overdue] status after:", JSON.stringify(dueAfter));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error("[overdue] failed:", error);
    process.exit(1);
});
