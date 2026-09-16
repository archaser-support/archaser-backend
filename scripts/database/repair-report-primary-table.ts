/**
 * Repair stuck report configs: backfill missing `primaryTable` and optionally
 * prefer Invoice grain when non-aggregated Invoice date/amount fields exist.
 *
 * Does NOT run on report execute — operators must dry-run, review, then apply.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/database/repair-report-primary-table.ts --dry-run
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/database/repair-report-primary-table.ts --apply
 *
 * Optional Invoice preference heuristic (explicit flag required):
 *   When Customer is the current grain (primaryTable or tables[0]), tables include
 *   Invoice, and the report has non-aggregated Invoice date/amount fields, set
 *   primaryTable to Invoice and pin tables[0] to Invoice.
 *
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/database/repair-report-primary-table.ts --dry-run --prefer-invoice-when-dates
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/database/repair-report-primary-table.ts --apply --prefer-invoice-when-dates
 *
 * Optional filters:
 *   --account-id=<id>   Only repair reports for this account
 *   --report-id=<id>    Only repair this report id
 *
 * Env: DATABASE_URL (required).
 */
import { Prisma, PrismaClient } from "@prisma/client";

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");
/** Explicit flag: prefer Invoice over Customer when date/amount fields suggest invoice grain. */
const PREFER_INVOICE_WHEN_DATES = process.argv.includes(
    "--prefer-invoice-when-dates"
);

function readArgValue(prefix: string): number | null {
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    if (!match) {
        return null;
    }
    const raw = match.slice(prefix.length);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

const ACCOUNT_ID = readArgValue("--account-id=");
const REPORT_ID = readArgValue("--report-id=");

/** Invoice fields that typically imply one-row-per-invoice grain when not aggregated. */
const INVOICE_DATE_AMOUNT_FIELDS = new Set([
    "due_date",
    "invoice_date",
    "amount",
    "outstanding_debt",
    "customer_amount",
    "original_amount",
]);

type ReportConfigLike = {
    primaryTable?: unknown;
    tables?: unknown;
    fields?: unknown;
};

type RepairAction =
    | "backfill_from_tables0"
    | "prefer_invoice_heuristic"
    | "sync_tables0_to_primary";

type Candidate = {
    id: number;
    account_id: number;
    name: string;
    context: string | null;
    action: RepairAction;
    fromPrimary: string | null;
    toPrimary: string;
    fromTables: string[];
    toTables: string[];
    nextConfig: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string");
}

function normalizePrimary(
    primaryTable: unknown,
    tables: string[]
): string | null {
    if (typeof primaryTable === "string" && primaryTable.trim()) {
        return primaryTable;
    }
    return tables[0] ?? null;
}

function pinPrimaryAtFront(tables: string[], primary: string): string[] {
    if (!tables.includes(primary)) {
        return [...tables];
    }
    return [primary, ...tables.filter((table) => table !== primary)];
}

function hasNonAggregatedInvoiceDateOrAmount(fields: unknown): boolean {
    if (!Array.isArray(fields)) {
        return false;
    }
    return fields.some((field) => {
        if (!isPlainObject(field)) {
            return false;
        }
        if (field.table !== "Invoice") {
            return false;
        }
        if (typeof field.field !== "string") {
            return false;
        }
        if (field.aggregation) {
            return false;
        }
        return INVOICE_DATE_AMOUNT_FIELDS.has(field.field);
    });
}

function buildCandidate(report: {
    id: number;
    account_id: number;
    name: string;
    context: string | null;
    report_config: unknown;
}): Candidate | null {
    if (!isPlainObject(report.report_config)) {
        return null;
    }

    const config = report.report_config as ReportConfigLike &
        Record<string, unknown>;
    const tables = asStringArray(config.tables);
    if (tables.length === 0) {
        return null;
    }

    const existingPrimary =
        typeof config.primaryTable === "string" && config.primaryTable.trim()
            ? config.primaryTable
            : null;
    const currentGrain = normalizePrimary(existingPrimary, tables);
    if (!currentGrain) {
        return null;
    }

    let action: RepairAction | null = null;
    let toPrimary = currentGrain;

    // 1) Missing primaryTable → backfill from tables[0]
    if (!existingPrimary) {
        action = "backfill_from_tables0";
        toPrimary = tables[0];
    }

    // 2) Optional heuristic: Customer grain + Invoice date/amount → Invoice
    //    Requires --prefer-invoice-when-dates. Never applied silently.
    if (
        PREFER_INVOICE_WHEN_DATES &&
        tables.includes("Customer") &&
        tables.includes("Invoice") &&
        toPrimary === "Customer" &&
        hasNonAggregatedInvoiceDateOrAmount(config.fields)
    ) {
        action = "prefer_invoice_heuristic";
        toPrimary = "Invoice";
    }

    const toTables = pinPrimaryAtFront(tables, toPrimary);
    const needsTablesSync =
        !!existingPrimary &&
        tables[0] !== existingPrimary &&
        tables.includes(existingPrimary);

    if (!action && needsTablesSync) {
        action = "sync_tables0_to_primary";
        toPrimary = existingPrimary;
    }

    if (!action) {
        return null;
    }

    // Skip no-op writes
    if (
        existingPrimary === toPrimary &&
        tables.join(",") === toTables.join(",")
    ) {
        return null;
    }

    const nextConfig: Record<string, unknown> = {
        ...config,
        primaryTable: toPrimary,
        tables: toTables,
    };

    return {
        id: report.id,
        account_id: report.account_id,
        name: report.name,
        context: report.context,
        action,
        fromPrimary: existingPrimary,
        toPrimary,
        fromTables: tables,
        toTables,
        nextConfig,
    };
}

function printHelpAndExit(code: number): never {
    console.log(`
repair-report-primary-table.ts

Backfill missing report_config.primaryTable from tables[0].
Optionally prefer Invoice when Customer is grain and Invoice date/amount
fields exist without aggregation (--prefer-invoice-when-dates).

Modes (pick one):
  --dry-run     List candidates; no writes
  --apply       Write updated report_config

Flags:
  --prefer-invoice-when-dates   Explicit heuristic (off by default)
  --account-id=<id>             Limit to one account
  --report-id=<id>              Limit to one report

Examples:
  npx ts-node --compiler-options '{"module":"commonjs"}' scripts/database/repair-report-primary-table.ts --dry-run
  npx ts-node --compiler-options '{"module":"commonjs"}' scripts/database/repair-report-primary-table.ts --apply --prefer-invoice-when-dates
`);
    process.exit(code);
}

async function main() {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        printHelpAndExit(0);
    }

    if (DRY_RUN === APPLY) {
        console.error(
            "Specify exactly one of --dry-run or --apply (see --help)."
        );
        process.exit(1);
    }

    const prisma = new PrismaClient();
    try {
        const where: Prisma.ReportWhereInput = {};
        if (ACCOUNT_ID != null) {
            where.account_id = ACCOUNT_ID;
        }
        if (REPORT_ID != null) {
            where.id = REPORT_ID;
        }

        console.log(
            `[repair-report-primary] mode=${DRY_RUN ? "dry-run" : "APPLY"} preferInvoice=${PREFER_INVOICE_WHEN_DATES} accountId=${ACCOUNT_ID ?? "all"} reportId=${REPORT_ID ?? "all"}`
        );

        const reports = await prisma.report.findMany({
            where,
            select: {
                id: true,
                account_id: true,
                name: true,
                context: true,
                report_config: true,
            },
            orderBy: { id: "asc" },
        });

        const candidates: Candidate[] = [];
        for (const report of reports) {
            const candidate = buildCandidate(report);
            if (candidate) {
                candidates.push(candidate);
            }
        }

        console.log(
            `[repair-report-primary] scanned=${reports.length} candidates=${candidates.length}`
        );

        for (const c of candidates) {
            console.log(
                JSON.stringify({
                    id: c.id,
                    account_id: c.account_id,
                    name: c.name,
                    context: c.context,
                    action: c.action,
                    fromPrimary: c.fromPrimary,
                    toPrimary: c.toPrimary,
                    fromTables: c.fromTables,
                    toTables: c.toTables,
                })
            );
        }

        if (DRY_RUN) {
            console.log(
                "[repair-report-primary] dry-run complete — no writes"
            );
            return;
        }

        let updated = 0;
        for (const c of candidates) {
            await prisma.report.update({
                where: { id: c.id },
                data: {
                    report_config: c.nextConfig as Prisma.InputJsonValue,
                },
            });
            updated += 1;
        }
        console.log(
            `[repair-report-primary] apply complete — updated=${updated}`
        );
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error("[repair-report-primary] failed:", err);
    process.exit(1);
});
