/**
 * One-time restamp of created-in-MEP (`ctv_customer_overdue_mep`) after Extra Days
 * were wired into the shared customer overdue-block math.
 *
 * For customers with a MEP cutoff + Extra Days pair:
 *   1. syncCustomerInsuranceFields (overdue_block uses Extra Days)
 *   2. refreshCtvSnapshotsForInvoiceIds for Due / Overdue / Paid invoices
 *
 * Usage:
 *   npx tsx scripts/datafixes/restamp-ctv-mep-extra-days.ts --dry-run
 *   npx tsx scripts/datafixes/restamp-ctv-mep-extra-days.ts --fix
 *   npx tsx scripts/datafixes/restamp-ctv-mep-extra-days.ts --account 10149 --fix
 *   npx tsx scripts/datafixes/restamp-ctv-mep-extra-days.ts --customer 4036 --dry-run
 */
import "dotenv/config";
import { PrismaClient, type invoice_status } from "@prisma/client";

import {
    bindCreditInsurancePrisma,
    refreshCtvSnapshotsForInvoiceIds,
    syncCustomerInsuranceFields,
} from "@archaser/credit-insurance-domain";

const STATUSES: invoice_status[] = ["Due", "Overdue", "Paid"];
const INVOICE_CHUNK = 500;

function parseArgs(argv: string[]): {
    dryRun: boolean;
    fix: boolean;
    accountId: number | null;
    customerId: number | null;
} {
    const dryRun = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }
    const accountIndex = argv.indexOf("--account");
    const customerIndex = argv.indexOf("--customer");
    const accountRaw =
        accountIndex === -1 ? undefined : argv[accountIndex + 1];
    const customerRaw =
        customerIndex === -1 ? undefined : argv[customerIndex + 1];
    const accountId =
        accountRaw == null ? null : Number(accountRaw);
    const customerId =
        customerRaw == null ? null : Number(customerRaw);
    if (accountRaw != null && (!Number.isInteger(accountId) || accountId! <= 0)) {
        throw new Error("--account <id> must be a positive integer");
    }
    if (
        customerRaw != null &&
        (!Number.isInteger(customerId) || customerId! <= 0)
    ) {
        throw new Error("--customer <id> must be a positive integer");
    }
    return { dryRun, fix, accountId, customerId };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);

    try {
        const policies = await prisma.customerPolicy.findMany({
            where: {
                is_active: true,
                mep_cutoff_day: { not: null },
                mep_substitute_extra_days: { not: null },
                ...(args.customerId != null
                    ? { customer_id: args.customerId }
                    : {}),
                ...(args.accountId != null
                    ? { Customer: { account_id: args.accountId } }
                    : {}),
            },
            select: {
                customer_id: true,
            },
        });

        const customerIds = Array.from(
            new Set(policies.map((row) => row.customer_id))
        );
        console.log(
            `Customers with MEP cutoff pair: ${customerIds.length}` +
                (args.accountId != null ? ` (account ${args.accountId})` : "") +
                (args.customerId != null
                    ? ` (customer ${args.customerId})`
                    : "")
        );

        if (customerIds.length === 0) {
            console.log("Nothing to do.");
            return;
        }

        const invoices = await prisma.invoice.findMany({
            where: {
                customer_id: { in: customerIds },
                status: { in: STATUSES },
            },
            select: {
                id: true,
                status: true,
                ctv_customer_overdue_mep: true,
            },
        });

        const byStatus = invoices.reduce<Record<string, number>>(
            (acc, row) => {
                acc[row.status] = (acc[row.status] ?? 0) + 1;
                return acc;
            },
            {}
        );
        const flaggedBefore = invoices.filter(
            (row) => row.ctv_customer_overdue_mep
        ).length;

        console.log("Invoice counts by status:", byStatus);
        console.log(
            `Invoices currently flagged ctv_customer_overdue_mep: ${flaggedBefore}`
        );

        if (args.dryRun) {
            console.log("Dry run — no changes applied.");
            return;
        }

        let customersSynced = 0;
        for (const customerId of customerIds) {
            await syncCustomerInsuranceFields(customerId, {
                runFollowUpEffects: false,
            });
            customersSynced += 1;
            if (customersSynced % 25 === 0) {
                console.log(
                    `Synced overdue_block for ${customersSynced}/${customerIds.length} customers…`
                );
            }
        }
        console.log(
            `Synced overdue_block for ${customersSynced} customer(s).`
        );

        const invoiceIds = invoices.map((row) => row.id);
        let restamped = 0;
        for (
            let offset = 0;
            offset < invoiceIds.length;
            offset += INVOICE_CHUNK
        ) {
            const chunk = invoiceIds.slice(offset, offset + INVOICE_CHUNK);
            restamped += await refreshCtvSnapshotsForInvoiceIds(chunk, prisma);
            console.log(
                `CTV restamp progress: ${Math.min(offset + chunk.length, invoiceIds.length)}/${invoiceIds.length}`
            );
        }

        const after = await prisma.invoice.findMany({
            where: { id: { in: invoiceIds } },
            select: { id: true, ctv_customer_overdue_mep: true },
        });
        const flaggedAfter = after.filter(
            (row) => row.ctv_customer_overdue_mep
        ).length;
        const cleared = flaggedBefore - flaggedAfter;

        console.log(`CTV snapshot writes reported: ${restamped}`);
        console.log(
            `Flagged before → after: ${flaggedBefore} → ${flaggedAfter}` +
                (cleared > 0 ? ` (cleared ${cleared})` : "")
        );
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
