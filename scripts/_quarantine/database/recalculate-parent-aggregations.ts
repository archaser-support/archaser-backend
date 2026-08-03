/**
 * Script to recalculate all parent customer aggregated data
 *
 * Usage:
 *   npx ts-node scripts/database/recalculate-parent-aggregations.ts [accountId]
 *
 * If accountId is provided, only recalculates for that account.
 * If no accountId is provided, recalculates for all accounts.
 */

import { PrismaClient } from "@prisma/client";

import { CustomerAggregationService } from "../../frontend/server/services/CustomerAggregationService";

const prisma = new PrismaClient();

async function main() {
    const accountIdArg = process.argv[2];
    const accountId: number | null = accountIdArg
        ? parseInt(accountIdArg, 10)
        : null;

    if (accountIdArg && (isNaN(accountId as number) || accountId === null)) {
        console.error("Invalid account ID provided");
        process.exit(1);
    }

    console.log(
        accountId
            ? `Recalculating aggregated data for account ${accountId}...`
            : "Recalculating aggregated data for all accounts..."
    );

    try {
        const aggregationService = CustomerAggregationService.getInstance();

        if (accountId) {
            // Recalculate for specific account
            await aggregationService.recalculateAllParentCustomers(accountId);
            console.log(`✓ Completed recalculation for account ${accountId}`);
        } else {
            // Recalculate for all accounts
            const accounts = await prisma.account.findMany({
                select: { id: true },
            });

            console.log(`Found ${accounts.length} accounts to process`);

            for (const account of accounts) {
                try {
                    console.log(`Processing account ${account.id}...`);
                    await aggregationService.recalculateAllParentCustomers(
                        account.id
                    );
                    console.log(`✓ Completed account ${account.id}`);
                } catch (error: any) {
                    console.error(
                        `✗ Error processing account ${account.id}:`,
                        error.message
                    );
                }
            }

            console.log("✓ Completed recalculation for all accounts");
        }
    } catch (error: any) {
        console.error("Error during recalculation:", error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main()
    .then(() => {
        console.log("Script completed successfully");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Script failed:", error);
        process.exit(1);
    });
