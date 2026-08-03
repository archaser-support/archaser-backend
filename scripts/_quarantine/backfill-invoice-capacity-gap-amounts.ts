/**
 * Backfill stored invoice capacity gap fields for open invoices with limit snapshots.
 *
 * Usage:
 *   npx tsx scripts/backfill-invoice-capacity-gap-amounts.ts
 *   npx tsx scripts/backfill-invoice-capacity-gap-amounts.ts --dry-run
 */
import { prisma } from "../frontend/lib/prisma";
import { syncCreditInsuranceGapPipelineForCustomer } from "../frontend/server/services/creditInsurance/syncCreditInsuranceGapPipeline";

const dryRun = process.argv.includes("--dry-run");

async function main() {
    const customers = await prisma.customer.findMany({
        where: {
            Account: { has_credit_insurance: true },
            Invoice: {
                some: {
                    status: { in: ["Due", "Overdue"] },
                    limit_assessed_amount: { not: null },
                },
            },
        },
        select: { id: true },
    });

    console.log(
        `${dryRun ? "[dry-run] " : ""}Backfilling invoice capacity gaps for ${customers.length} customers`
    );

    for (const { id } of customers) {
        if (dryRun) {
            continue;
        }
        await syncCreditInsuranceGapPipelineForCustomer(id);
    }

    console.log("Done.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
