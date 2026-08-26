/**
 * Drop legacy Prisma `Payment` table after rewriting/deleting report configs
 * that still reference it, and stripping account generic_field_config.payment.
 *
 * Import/ERP entity type "Payment" is unrelated and must remain (writes InvoicePayment).
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/database/drop-legacy-payment-table.ts --dry-run
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/database/drop-legacy-payment-table.ts
 *
 * Env: DATABASE_URL (required).
 */
import { Prisma, PrismaClient } from "@prisma/client";

const DRY_RUN = process.argv.includes("--dry-run");

/** Fields that map 1:1 from Payment → InvoicePayment. */
const MAPPABLE_FIELDS = new Set([
    "id",
    "amount",
    "payment_date",
    "payment_method",
    "reference",
    "created_at",
    "modified_at",
    "customer_id",
    "account_id",
    "customer_amount",
    "customer_currency",
    "created_by",
    "modified_by",
]);

/** Joins from Payment that map to InvoicePayment. */
const MAPPABLE_JOINS_TO = new Set(["Customer", "Account"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectTableRefs(node: unknown, refs: Set<string>): void {
    if (Array.isArray(node)) {
        for (const item of node) {
            collectTableRefs(item, refs);
        }
        return;
    }
    if (!isPlainObject(node)) {
        return;
    }
    if (typeof node.table === "string") {
        refs.add(node.table);
    }
    if (Array.isArray(node.tables)) {
        for (const t of node.tables) {
            if (typeof t === "string") {
                refs.add(t);
            }
        }
    }
    for (const value of Object.values(node)) {
        collectTableRefs(value, refs);
    }
}

function configReferencesPayment(config: unknown, context: string | null): boolean {
    if (context === "payments") {
        return true;
    }
    const refs = new Set<string>();
    collectTableRefs(config, refs);
    return refs.has("Payment");
}

/**
 * Walk config and ensure every Payment field/join is mappable.
 * Returns false if any non-mappable Payment usage is found.
 */
function everyPaymentUsageMaps(node: unknown): boolean {
    if (Array.isArray(node)) {
        return node.every((item) => everyPaymentUsageMaps(item));
    }
    if (!isPlainObject(node)) {
        return true;
    }

    const table = typeof node.table === "string" ? node.table : null;
    if (table === "Payment") {
        if (typeof node.field === "string" && !MAPPABLE_FIELDS.has(node.field)) {
            return false;
        }
        if (
            typeof node.from === "string" &&
            node.from === "Payment" &&
            typeof node.to === "string" &&
            !MAPPABLE_JOINS_TO.has(node.to)
        ) {
            return false;
        }
        if (node.to === "Payment" && node.from === "InvoicePayment") {
            return false;
        }
    }

    if (
        node.from === "Payment" &&
        typeof node.to === "string" &&
        !MAPPABLE_JOINS_TO.has(node.to)
    ) {
        return false;
    }
    if (node.to === "Payment" && node.from === "InvoicePayment") {
        return false;
    }

    for (const value of Object.values(node)) {
        if (!everyPaymentUsageMaps(value)) {
            return false;
        }
    }
    return true;
}

function rewritePaymentToInvoicePayment(node: unknown): unknown {
    if (Array.isArray(node)) {
        return node.map((item) => rewritePaymentToInvoicePayment(item));
    }
    if (!isPlainObject(node)) {
        return node;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
        if (key === "table" && value === "Payment") {
            out[key] = "InvoicePayment";
            continue;
        }
        if (key === "tables" && Array.isArray(value)) {
            out[key] = value.map((t) =>
                t === "Payment" ? "InvoicePayment" : rewritePaymentToInvoicePayment(t)
            );
            continue;
        }
        if ((key === "from" || key === "to") && value === "Payment") {
            out[key] = "InvoicePayment";
            continue;
        }
        out[key] = rewritePaymentToInvoicePayment(value);
    }
    return out;
}

async function main(): Promise<void> {
    if (!process.env.DATABASE_URL) {
        console.error("[drop-legacy-payment] DATABASE_URL is required");
        process.exit(1);
    }

    const prisma = new PrismaClient();
    console.info(
        `[drop-legacy-payment] starting (${DRY_RUN ? "dry-run" : "APPLY"})`
    );

    try {
        const reports = await prisma.report.findMany({
            select: {
                id: true,
                name: true,
                unique_name: true,
                account_id: true,
                context: true,
                report_config: true,
            },
        });

        const toRewrite: { id: number; name: string; config: unknown }[] = [];
        const toDelete: { id: number; name: string; reason: string }[] = [];

        for (const report of reports) {
            const config = report.report_config as unknown;
            if (!configReferencesPayment(config, report.context)) {
                continue;
            }
            if (!everyPaymentUsageMaps(config)) {
                toDelete.push({
                    id: report.id,
                    name: report.name,
                    reason: "non-mappable Payment field/join",
                });
                continue;
            }
            // context payments alone with no Payment table refs still needs clear
            toRewrite.push({ id: report.id, name: report.name, config });
        }

        console.info(
            `[drop-legacy-payment] reports: rewrite=${toRewrite.length} delete=${toDelete.length}`
        );
        for (const r of toRewrite) {
            console.info(`  REWRITE report id=${r.id} name=${JSON.stringify(r.name)}`);
        }
        for (const r of toDelete) {
            console.info(
                `  DELETE  report id=${r.id} name=${JSON.stringify(r.name)} (${r.reason})`
            );
        }

        const accountsWithPaymentGeneric = await prisma.$queryRaw<
            { id: number }[]
        >`
            SELECT id FROM "Account"
            WHERE generic_field_config ? 'payment'
        `;
        console.info(
            `[drop-legacy-payment] accounts with generic_field_config.payment: ${accountsWithPaymentGeneric.length}`
        );

        const paymentCountRows = await prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'Payment'
        `;
        const tableExists = Number(paymentCountRows[0]?.count ?? 0) > 0;
        let legacyRowCount = 0;
        if (tableExists) {
            const rows = await prisma.$queryRaw<{ count: bigint }[]>`
                SELECT COUNT(*)::bigint AS count FROM "Payment"
            `;
            legacyRowCount = Number(rows[0]?.count ?? 0);
        }
        console.info(
            `[drop-legacy-payment] Payment table exists=${tableExists} rowCount=${legacyRowCount}`
        );

        if (DRY_RUN) {
            console.info("[drop-legacy-payment] dry-run complete — no writes");
            return;
        }

        await prisma.$transaction(async (tx) => {
            for (const r of toDelete) {
                await tx.report.delete({ where: { id: r.id } });
            }

            for (const r of toRewrite) {
                const report = await tx.report.findUnique({
                    where: { id: r.id },
                    select: { context: true, report_config: true },
                });
                if (!report) {
                    continue;
                }
                const nextConfig = rewritePaymentToInvoicePayment(
                    report.report_config
                ) as Prisma.InputJsonValue;
                const nextContext =
                    report.context === "payments" ? null : report.context;
                await tx.report.update({
                    where: { id: r.id },
                    data: {
                        report_config: nextConfig,
                        context: nextContext,
                    },
                });
            }

            await tx.$executeRaw`
                UPDATE "Account"
                SET generic_field_config = generic_field_config - 'payment'
                WHERE generic_field_config ? 'payment'
            `;

            if (tableExists) {
                await tx.$executeRaw`DROP TABLE IF EXISTS "Payment"`;
            }
        });

        console.info(
            `[drop-legacy-payment] done — deleted ${toDelete.length} reports, rewrote ${toRewrite.length}, dropped Payment (had ${legacyRowCount} rows)`
        );
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error("[drop-legacy-payment] failed:", err);
    process.exit(1);
});
