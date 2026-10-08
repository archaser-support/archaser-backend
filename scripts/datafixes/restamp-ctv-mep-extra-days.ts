/**
 * One-time restamp of created-in-MEP (`ctv_customer_overdue_mep`) after Extra Days
 * were wired into the shared customer overdue-block math. Also backfills MEP cause
 * snapshot columns (due date / outstanding / days past MEP) used by the breach tooltip.
 *
 * Default cohort: active CustomerPolicy with MEP cutoff + Extra Days.
 * `--all-customers`: every customer with an active policy (needed for account-wide
 * tooltip snapshot backfill).
 *
 * Usage:
 *   npx tsx scripts/datafixes/restamp-ctv-mep-extra-days.ts --dry-run
 *   npx tsx scripts/datafixes/restamp-ctv-mep-extra-days.ts --fix
 *   npx tsx scripts/datafixes/restamp-ctv-mep-extra-days.ts --account 10149 --fix
 *   npx tsx scripts/datafixes/restamp-ctv-mep-extra-days.ts --account 10149 --all-customers --fix
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
    allCustomers: boolean;
    accountId: number | null;
    customerId: number | null;
} {
    const dryRun = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }
    const allCustomers = argv.includes("--all-customers");
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
    return { dryRun, fix, allCustomers, accountId, customerId };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);

    try {
        const policies = await prisma.customerPolicy.findMany({
            where: {
                is_active: true,
                ...(args.allCustomers
                    ? {}
                    : {
                          mep_cutoff_day: { not: null },
                          mep_substitute_extra_days: { not: null },
                      }),
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
            (args.allCustomers
                ? `Customers with active policy: ${customerIds.length}`
                : `Customers with MEP cutoff pair: ${customerIds.length}`) +
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
                ctv_customer_overdue_mep_cause_due_date: true,
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
        const mepMissingSnapshot = invoices.filter(
            (row) =>
                row.ctv_customer_overdue_mep &&
                row.ctv_customer_overdue_mep_cause_due_date == null
        ).length;

        console.log("Invoice counts by status:", byStatus);
        console.log(
            `Invoices currently flagged ctv_customer_overdue_mep: ${flaggedBefore}`
        );
        console.log(
            `MEP-flagged with missing cause snapshot (due date null): ${mepMissingSnapshot}`
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
            select: {
                id: true,
                ctv_customer_overdue_mep: true,
                ctv_customer_overdue_mep_cause_due_date: true,
            },
        });
        const flaggedAfter = after.filter(
            (row) => row.ctv_customer_overdue_mep
        ).length;
        const mepMissingSnapshotAfter = after.filter(
            (row) =>
                row.ctv_customer_overdue_mep &&
                row.ctv_customer_overdue_mep_cause_due_date == null
        ).length;
        const cleared = flaggedBefore - flaggedAfter;

        console.log(`CTV snapshot writes reported: ${restamped}`);
        console.log(
            `Flagged before → after: ${flaggedBefore} → ${flaggedAfter}` +
                (cleared > 0 ? ` (cleared ${cleared})` : "")
        );
        console.log(
            `MEP missing snapshot before → after: ${mepMissingSnapshot} → ${mepMissingSnapshotAfter}`
        );
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
