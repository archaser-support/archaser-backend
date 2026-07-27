/**
 * Datafix script to create primary business units for all existing accounts
 * and assign existing users to their account's primary BU if they don't have one.
 *
 * This script is idempotent and can be run multiple times safely.
 *
 * Usage:
 *   npx ts-node scripts/migrate-business-units.ts
 *   npx ts-node scripts/migrate-business-units.ts --dry-run
 *   npx ts-node scripts/migrate-business-units.ts --account-id=10013
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface DatafixStats {
    primaryBUsCreated: number;
    primaryBUsSkipped: number;
    usersAssigned: number;
    usersFailed: number;
    accountsProcessed: number;
    accountsWithErrors: number;
}

async function datafixBusinessUnits(options: {
    dryRun?: boolean;
    accountId?: number;
}): Promise<DatafixStats> {
    const { dryRun = false, accountId } = options;

    console.log("=".repeat(80));
    console.log("Business Unit Datafix Script");
    console.log("=".repeat(80));
    console.log(`Mode: ${dryRun ? "DRY RUN (no changes will be made)" : "LIVE (changes will be committed)"}`);
    if (accountId) {
        console.log(`Filter: Processing only account ID ${accountId}`);
    }
    console.log("=".repeat(80));

    // Find the support user for created_by/modified_by
    const supportUser = await prisma.user.findFirst({
        where: {
            email: "support@cloudial.io",
        },
        select: {
            id: true,
            email: true,
            name: true,
        },
    });

    if (!supportUser) {
        console.error("\n❌ Error: User with email 'support@cloudial.io' not found!");
        console.error("   Cannot set created_by/modified_by fields.");
        throw new Error("Support user not found");
    }

    console.log(`\n✓ Found support user: ${supportUser.email} (ID: ${supportUser.id})`);
    console.log(`  Will use this user ID for created_by and modified_by fields.\n`);

    const stats: DatafixStats = {
        primaryBUsCreated: 0,
        primaryBUsSkipped: 0,
        usersAssigned: 0,
        usersFailed: 0,
        accountsProcessed: 0,
        accountsWithErrors: 0,
    };

    try {
        // Step 1: Create primary BU for all existing accounts that don't have one
        console.log("\n📋 Step 1: Creating primary business units for existing accounts...");
        console.log("-".repeat(80));

        const accountsWhere = accountId
            ? { id: accountId }
            : {};

        const accounts = await prisma.account.findMany({
            where: accountsWhere,
            select: {
                id: true,
                name: true,
            },
            orderBy: {
                id: "asc",
            },
        });

        if (accounts.length === 0) {
            console.log("No accounts found to process.");
            return stats;
        }

        console.log(`Found ${accounts.length} account(s) to process.\n`);

        for (const account of accounts) {
            stats.accountsProcessed++;

            try {
                // Check if primary BU already exists
                const existingPrimary = await prisma.businessUnit.findFirst({
                    where: {
                        account_id: account.id,
                        is_primary: true,
                    },
                });

                if (existingPrimary) {
                    stats.primaryBUsSkipped++;
                    console.log(`✓ Account ${account.id} (${account.name || "Unnamed"}): Primary BU already exists (ID: ${existingPrimary.id})`);
                    continue;
                }

                // Create primary BU
                const buName = account.name
                    ? `${account.name.trim()} Primary`
                    : "Primary";

                if (dryRun) {
                    console.log(`[DRY RUN] Would create primary BU for account ${account.id} (${account.name || "Unnamed"}): "${buName}"`);
                    stats.primaryBUsCreated++;
                } else {
                    const createdBU = await prisma.businessUnit.create({
                        data: {
                            account_id: account.id,
                            name: buName,
                            status: "Active",
                            is_primary: true,
                            created_by: supportUser.id,
                            modified_by: supportUser.id,
                        },
                    });

                    stats.primaryBUsCreated++;
                    console.log(`✓ Created primary BU for account ${account.id} (${account.name || "Unnamed"}): "${buName}" (ID: ${createdBU.id})`);
                }
            } catch (error: any) {
                stats.accountsWithErrors++;
                console.error(`✗ Error processing account ${account.id} (${account.name || "Unnamed"}):`, error.message);
            }
        }

        console.log(`\n${  "-".repeat(80)}`);
        console.log(`Step 1 Summary: ${stats.primaryBUsCreated} created, ${stats.primaryBUsSkipped} skipped, ${stats.accountsWithErrors} errors`);

        // Step 2: Assign users to their account's primary BU if they don't have one
        console.log("\n📋 Step 2: Assigning users to their account's primary BU...");
        console.log("-".repeat(80));

        const usersWhere: any = {
            OR: [
                { business_unit_id: null },
            ],
        };

        if (accountId) {
            usersWhere.account_id = accountId;
        }

        const users = await prisma.user.findMany({
            where: usersWhere,
            select: {
                id: true,
                account_id: true,
                email: true,
                name: true,
            },
            orderBy: {
                account_id: "asc",
            },
        });

        if (users.length === 0) {
            console.log("No users found without business unit assignments.");
        } else {
            console.log(`Found ${users.length} user(s) without business unit assignments.\n`);

            for (const user of users) {
                try {
                    if (!user.account_id) {
                        console.log(`⚠ Skipping user ${user.id} (${user.email || user.name || "Unnamed"}): no account_id`);
                        stats.usersFailed++;
                        continue;
                    }

                    // Find primary BU for the user's account
                    const primaryBU = await prisma.businessUnit.findFirst({
                        where: {
                            account_id: user.account_id,
                            is_primary: true,
                        },
                    });

                    if (!primaryBU) {
                        console.log(
                            `⚠ Warning: No primary BU found for account ${user.account_id} (user ${user.id}, ${user.email || user.name || "Unnamed"})`
                        );
                        stats.usersFailed++;
                        continue;
                    }

                    if (dryRun) {
                        console.log(
                            `[DRY RUN] Would assign user ${user.id} (${user.email || user.name || "Unnamed"}) to primary BU ${primaryBU.id} (${primaryBU.name})`
                        );
                        stats.usersAssigned++;
                    } else {
                        await prisma.user.update({
                            where: { id: user.id },
                            data: { business_unit_id: primaryBU.id },
                        });

                        stats.usersAssigned++;
                        console.log(
                            `✓ Assigned user ${user.id} (${user.email || user.name || "Unnamed"}) to primary BU ${primaryBU.id} (${primaryBU.name})`
                        );
                    }
                } catch (error: any) {
                    stats.usersFailed++;
                    console.error(
                        `✗ Error assigning user ${user.id} (${user.email || user.name || "Unnamed"}):`,
                        error.message
                    );
                }
            }
        }

        console.log(`\n${  "-".repeat(80)}`);
        console.log(`Step 2 Summary: ${stats.usersAssigned} assigned, ${stats.usersFailed} failed`);

        // Step 3: Update existing business units with null created_by/modified_by
        console.log("\n📋 Step 3: Updating existing business units with null created_by/modified_by...");
        console.log("-".repeat(80));

        const buWhere: any = {
            OR: [
                { created_by: null },
                { modified_by: null },
            ],
        };

        if (accountId) {
            buWhere.account_id = accountId;
        }

        const buStats = {
            updated: 0,
            failed: 0,
        };

        const existingBUs = await prisma.businessUnit.findMany({
            where: buWhere,
            select: {
                id: true,
                account_id: true,
                name: true,
                created_by: true,
                modified_by: true,
            },
        });

        if (existingBUs.length === 0) {
            console.log("No business units found with null created_by/modified_by.");
        } else {
            console.log(`Found ${existingBUs.length} business unit(s) with null created_by/modified_by.\n`);

            for (const bu of existingBUs) {
                try {
                    if (dryRun) {
                        console.log(
                            `[DRY RUN] Would update BU ${bu.id} (${bu.name || "Unnamed"}) - set created_by/modified_by to ${supportUser.id}`
                        );
                        buStats.updated++;
                    } else {
                        await prisma.businessUnit.update({
                            where: { id: bu.id },
                            data: {
                                created_by: bu.created_by || supportUser.id,
                                modified_by: bu.modified_by || supportUser.id,
                            },
                        });

                        buStats.updated++;
                        console.log(
                            `✓ Updated BU ${bu.id} (${bu.name || "Unnamed"}) - set created_by/modified_by to ${supportUser.id}`
                        );
                    }
                } catch (error: any) {
                    buStats.failed++;
                    console.error(`✗ Error updating BU ${bu.id} (${bu.name || "Unnamed"}):`, error.message);
                }
            }
        }

        console.log(`\n${  "-".repeat(80)}`);
        console.log(`Step 3 Summary: ${buStats.updated} updated, ${buStats.failed} failed`);

        // Final summary
        console.log(`\n${  "=".repeat(80)}`);
        console.log("📊 DATAFIX SUMMARY");
        console.log("=".repeat(80));
        console.log(`Accounts processed: ${stats.accountsProcessed}`);
        console.log(`Primary BUs created: ${stats.primaryBUsCreated}`);
        console.log(`Primary BUs skipped (already exist): ${stats.primaryBUsSkipped}`);
        console.log(`Users assigned to primary BU: ${stats.usersAssigned}`);
        console.log(`Users failed/errors: ${stats.usersFailed}`);
        console.log(`Accounts with errors: ${stats.accountsWithErrors}`);
        console.log("=".repeat(80));

        if (dryRun) {
            console.log("\n⚠️  DRY RUN MODE: No changes were made to the database.");
            console.log("   Run without --dry-run to apply changes.");
        } else {
            console.log("\n✅ Datafix completed successfully!");
        }

        return stats;
    } catch (error: any) {
        console.error("\n❌ Datafix failed:", error);
        throw error;
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const accountIdArg = args.find((arg) => arg.startsWith("--account-id="));
const accountId = accountIdArg ? parseInt(accountIdArg.split("=")[1], 10) : undefined;

if (accountIdArg && isNaN(accountId!)) {
    console.error("Error: Invalid account-id format. Use --account-id=<number>");
    process.exit(1);
}

// Run datafix
datafixBusinessUnits({ dryRun, accountId })
    .then(() => {
        console.log("\nScript completed.");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\nScript failed:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

