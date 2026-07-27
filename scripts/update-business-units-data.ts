/**
 * Database update script for Business Units
 *
 * PREREQUISITE: Run the SQL migration first to create the table:
 *   psql -d your_database -f prisma/migrations/create_business_unit_table.sql
 *
 * This script performs comprehensive data updates and integrity checks for Business Units:
 * 1. Verifies BusinessUnit table exists (will fail if not created)
 * 2. Ensures all accounts have primary business units
 * 3. Assigns users to primary BUs if they don't have one
 * 4. Validates and fixes orphaned BU references (customers/users with invalid BU IDs)
 * 5. Updates null created_by/modified_by fields
 * 6. Ensures proper BU hierarchy (no circular references, valid parent relationships)
 * 7. Validates external_id uniqueness per account
 *
 * This script is idempotent and can be run multiple times safely.
 *
 * Usage:
 *   npx ts-node scripts/update-business-units-data.ts
 *   npx ts-node scripts/update-business-units-data.ts --dry-run
 *   npx ts-node scripts/update-business-units-data.ts --account-id=10013
 *   npx ts-node scripts/update-business-units-data.ts --fix-orphans
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface UpdateStats {
    accountsProcessed: number;
    primaryBUsCreated: number;
    primaryBUsSkipped: number;
    usersAssigned: number;
    usersFailed: number;
    orphanedCustomersFixed: number;
    orphanedUsersFixed: number;
    buMetadataUpdated: number;
    circularReferencesFixed: number;
    duplicateExternalIdsFixed: number;
    accountsWithErrors: number;
}

async function updateBusinessUnitsData(options: {
    dryRun?: boolean;
    accountId?: number;
    fixOrphans?: boolean;
}): Promise<UpdateStats> {
    const { dryRun = false, accountId, fixOrphans = true } = options;

    console.log("=".repeat(80));
    console.log("Business Unit Database Update Script");
    console.log("=".repeat(80));
    console.log(
        `Mode: ${dryRun ? "DRY RUN (no changes will be made)" : "LIVE (changes will be committed)"}`
    );
    if (accountId) {
        console.log(`Filter: Processing only account ID ${accountId}`);
    }
    console.log(`Fix Orphans: ${fixOrphans ? "Yes" : "No"}`);
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
        console.error(
            "\n❌ Error: User with email 'support@cloudial.io' not found!"
        );
        console.error("   Cannot set created_by/modified_by fields.");
        throw new Error("Support user not found");
    }

    console.log(
        `\n✓ Found support user: ${supportUser.email} (ID: ${supportUser.id})`
    );
    console.log(
        `  Will use this user ID for created_by and modified_by fields.\n`
    );

    const stats: UpdateStats = {
        accountsProcessed: 0,
        primaryBUsCreated: 0,
        primaryBUsSkipped: 0,
        usersAssigned: 0,
        usersFailed: 0,
        orphanedCustomersFixed: 0,
        orphanedUsersFixed: 0,
        buMetadataUpdated: 0,
        circularReferencesFixed: 0,
        duplicateExternalIdsFixed: 0,
        accountsWithErrors: 0,
    };

    try {
        // Step 0: Verify BusinessUnit table exists
        console.log("\n📋 Step 0: Verifying BusinessUnit table exists...");
        console.log("-".repeat(80));

        try {
            const tableCheck = await prisma.$queryRaw<
                Array<{ exists: boolean }>
            >`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'BusinessUnit'
                ) as exists
            `;

            if (!tableCheck[0]?.exists) {
                console.error("\n❌ Error: BusinessUnit table does not exist!");
                console.error("   Please run the SQL migration first:");
                console.error(
                    "   psql -d your_database -f prisma/migrations/create_business_unit_table.sql"
                );
                throw new Error(
                    "BusinessUnit table does not exist. Run SQL migration first."
                );
            }

            console.log("✓ BusinessUnit table exists");
        } catch (error: any) {
            if (error.message.includes("does not exist")) {
                throw error;
            }
            // If it's a different error (e.g., permission issue), try a simpler check
            try {
                await prisma.businessUnit.findFirst({ take: 1 });
                console.log("✓ BusinessUnit table exists (verified via query)");
            } catch (queryError: any) {
                console.error("\n❌ Error: Cannot access BusinessUnit table!");
                console.error("   Please run the SQL migration first:");
                console.error(
                    "   psql -d your_database -f prisma/migrations/create_business_unit_table.sql"
                );
                throw new Error(
                    "BusinessUnit table does not exist or is not accessible. Run SQL migration first."
                );
            }
        }

        // Step 1: Create primary BU for all existing accounts that don't have one
        console.log(
            "\n📋 Step 1: Ensuring all accounts have primary business units..."
        );
        console.log("-".repeat(80));

        const accountsWhere = accountId ? { id: accountId } : {};

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
                    console.log(
                        `✓ Account ${account.id} (${account.name || "Unnamed"}): Primary BU already exists (ID: ${existingPrimary.id})`
                    );
                    continue;
                }

                // Create primary BU
                const buName = account.name
                    ? `${account.name.trim()} Primary`
                    : "Primary";

                if (dryRun) {
                    console.log(
                        `[DRY RUN] Would create primary BU for account ${account.id} (${account.name || "Unnamed"}): "${buName}"`
                    );
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
                    console.log(
                        `✓ Created primary BU for account ${account.id} (${account.name || "Unnamed"}): "${buName}" (ID: ${createdBU.id})`
                    );
                }
            } catch (error: any) {
                stats.accountsWithErrors++;
                console.error(
                    `✗ Error processing account ${account.id} (${account.name || "Unnamed"}):`,
                    error.message
                );
            }
        }

        console.log(`\n${"-".repeat(80)}`);
        console.log(`Step 1 Summary: ${stats.primaryBUsCreated} created, ${stats.primaryBUsSkipped} skipped, ${stats.accountsWithErrors} errors`);

        // Step 2: Assign users to their account's primary BU if they don't have one or have invalid reference
        console.log(
            "\n📋 Step 2: Assigning users to their account's primary BU..."
        );
        console.log("-".repeat(80));

        // Get all users (we'll check for null or invalid BU references)
        const usersWhere: any = accountId ? { account_id: accountId } : {};

        const allUsers = await prisma.user.findMany({
            where: usersWhere,
            select: {
                id: true,
                account_id: true,
                business_unit_id: true,
                email: true,
                name: true,
            },
            orderBy: {
                account_id: "asc",
            },
        });

        // Filter users who need BU assignment (null or invalid BU reference)
        const usersNeedingAssignment: Array<{
            id: string;
            account_id: number | null;
            business_unit_id: number | null;
            email: string | null;
            name: string | null;
        }> = [];

        for (const user of allUsers) {
            if (!user.business_unit_id) {
                // User has no BU assignment
                usersNeedingAssignment.push(user);
            } else {
                // Check if BU reference is valid
                try {
                    const buExists = await prisma.businessUnit.findUnique({
                        where: { id: user.business_unit_id },
                        select: { id: true, account_id: true },
                    });

                    if (
                        !buExists ||
                        (user.account_id &&
                            buExists.account_id !== user.account_id)
                    ) {
                        // BU doesn't exist or belongs to different account
                        usersNeedingAssignment.push(user);
                    }
                } catch (error) {
                    // If we can't verify, assume it needs fixing
                    usersNeedingAssignment.push(user);
                }
            }
        }

        if (usersNeedingAssignment.length === 0) {
            console.log(
                "No users found without valid business unit assignments."
            );
        } else {
            console.log(
                `Found ${usersNeedingAssignment.length} user(s) without valid business unit assignments.\n`
            );

            for (const user of usersNeedingAssignment) {
                try {
                    if (!user.account_id) {
                        console.log(
                            `⚠ Skipping user ${user.id} (${user.email || user.name || "Unnamed"}): no account_id`
                        );
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
                        const currentBU = user.business_unit_id
                            ? ` (currently: ${user.business_unit_id})`
                            : "";
                        console.log(
                            `[DRY RUN] Would assign user ${user.id} (${user.email || user.name || "Unnamed"})${currentBU} to primary BU ${primaryBU.id} (${primaryBU.name})`
                        );
                        stats.usersAssigned++;
                    } else {
                        await prisma.user.update({
                            where: { id: user.id },
                            data: { business_unit_id: primaryBU.id },
                        });

                        const currentBU = user.business_unit_id
                            ? ` (was: ${user.business_unit_id})`
                            : "";
                        stats.usersAssigned++;
                        console.log(
                            `✓ Assigned user ${user.id} (${user.email || user.name || "Unnamed"})${currentBU} to primary BU ${primaryBU.id} (${primaryBU.name})`
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

        console.log(`\n${"-".repeat(80)}`);
        console.log(`Step 2 Summary: ${stats.usersAssigned} assigned, ${stats.usersFailed} failed`);

        // Step 3: Fix orphaned BU references (if enabled)
        if (fixOrphans) {
            console.log(
                "\n📋 Step 3: Fixing orphaned business unit references..."
            );
            console.log("-".repeat(80));

            // Fix orphaned customer BU references
            const customersWhere: any = {
                business_unit_id: { not: null },
            };

            if (accountId) {
                customersWhere.account_id = accountId;
            }

            const customersWithBU = await prisma.customer.findMany({
                where: customersWhere,
                select: {
                    id: true,
                    account_id: true,
                    business_unit_id: true,
                },
            });

            console.log(
                `Found ${customersWithBU.length} customer(s) with BU assignments to validate.\n`
            );

            for (const customer of customersWithBU) {
                if (!customer.business_unit_id) continue;

                try {
                    const buExists = await prisma.businessUnit.findUnique({
                        where: { id: customer.business_unit_id },
                        select: { id: true, account_id: true },
                    });

                    if (!buExists) {
                        // BU doesn't exist - find primary BU for customer's account
                        const primaryBU = await prisma.businessUnit.findFirst({
                            where: {
                                account_id: customer.account_id,
                                is_primary: true,
                            },
                        });

                        if (primaryBU) {
                            if (dryRun) {
                                console.log(
                                    `[DRY RUN] Would fix orphaned BU reference for customer ${customer.id}: ${customer.business_unit_id} -> ${primaryBU.id}`
                                );
                                stats.orphanedCustomersFixed++;
                            } else {
                                await prisma.customer.update({
                                    where: { id: customer.id },
                                    data: { business_unit_id: primaryBU.id },
                                });
                                stats.orphanedCustomersFixed++;
                                console.log(
                                    `✓ Fixed orphaned BU reference for customer ${customer.id}: ${customer.business_unit_id} -> ${primaryBU.id}`
                                );
                            }
                        } else {
                            // No primary BU found - set to null
                            if (dryRun) {
                                console.log(
                                    `[DRY RUN] Would set BU to null for customer ${customer.id} (no primary BU found for account ${customer.account_id})`
                                );
                                stats.orphanedCustomersFixed++;
                            } else {
                                await prisma.customer.update({
                                    where: { id: customer.id },
                                    data: { business_unit_id: null },
                                });
                                stats.orphanedCustomersFixed++;
                                console.log(
                                    `✓ Set BU to null for customer ${customer.id} (no primary BU found for account ${customer.account_id})`
                                );
                            }
                        }
                    } else if (buExists.account_id !== customer.account_id) {
                        // BU belongs to different account - find primary BU for customer's account
                        const primaryBU = await prisma.businessUnit.findFirst({
                            where: {
                                account_id: customer.account_id,
                                is_primary: true,
                            },
                        });

                        if (primaryBU) {
                            if (dryRun) {
                                console.log(
                                    `[DRY RUN] Would fix cross-account BU reference for customer ${customer.id}: ${customer.business_unit_id} (account ${buExists.account_id}) -> ${primaryBU.id} (account ${customer.account_id})`
                                );
                                stats.orphanedCustomersFixed++;
                            } else {
                                await prisma.customer.update({
                                    where: { id: customer.id },
                                    data: { business_unit_id: primaryBU.id },
                                });
                                stats.orphanedCustomersFixed++;
                                console.log(
                                    `✓ Fixed cross-account BU reference for customer ${customer.id}: ${customer.business_unit_id} -> ${primaryBU.id}`
                                );
                            }
                        }
                    }
                } catch (error: any) {
                    console.error(
                        `✗ Error fixing customer ${customer.id}:`,
                        error.message
                    );
                }
            }

            // Fix orphaned user BU references
            const usersWhereBU: any = {
                business_unit_id: { not: null },
            };

            if (accountId) {
                usersWhereBU.account_id = accountId;
            }

            const usersWithBU = await prisma.user.findMany({
                where: usersWhereBU,
                select: {
                    id: true,
                    account_id: true,
                    business_unit_id: true,
                    email: true,
                },
            });

            console.log(
                `\nFound ${usersWithBU.length} user(s) with BU assignments to validate.\n`
            );

            for (const user of usersWithBU) {
                if (!user.business_unit_id) continue;

                try {
                    const buExists = await prisma.businessUnit.findUnique({
                        where: { id: user.business_unit_id },
                        select: { id: true, account_id: true },
                    });

                    if (!buExists) {
                        // BU doesn't exist - find primary BU for user's account
                        if (!user.account_id) {
                            continue; // Skip users without account_id
                        }
                        const primaryBU = await prisma.businessUnit.findFirst({
                            where: {
                                account_id: user.account_id,
                                is_primary: true,
                            },
                        });

                        if (primaryBU) {
                            if (dryRun) {
                                console.log(
                                    `[DRY RUN] Would fix orphaned BU reference for user ${user.id} (${user.email || "Unnamed"}): ${user.business_unit_id} -> ${primaryBU.id}`
                                );
                                stats.orphanedUsersFixed++;
                            } else {
                                await prisma.user.update({
                                    where: { id: user.id },
                                    data: { business_unit_id: primaryBU.id },
                                });
                                stats.orphanedUsersFixed++;
                                console.log(
                                    `✓ Fixed orphaned BU reference for user ${user.id} (${user.email || "Unnamed"}): ${user.business_unit_id} -> ${primaryBU.id}`
                                );
                            }
                        }
                    } else if (
                        user.account_id &&
                        buExists.account_id !== user.account_id
                    ) {
                        // BU belongs to different account - find primary BU for user's account
                        const primaryBU = await prisma.businessUnit.findFirst({
                            where: {
                                account_id: user.account_id,
                                is_primary: true,
                            },
                        });

                        if (primaryBU) {
                            if (dryRun) {
                                console.log(
                                    `[DRY RUN] Would fix cross-account BU reference for user ${user.id} (${user.email || "Unnamed"}): ${user.business_unit_id} -> ${primaryBU.id}`
                                );
                                stats.orphanedUsersFixed++;
                            } else {
                                await prisma.user.update({
                                    where: { id: user.id },
                                    data: { business_unit_id: primaryBU.id },
                                });
                                stats.orphanedUsersFixed++;
                                console.log(
                                    `✓ Fixed cross-account BU reference for user ${user.id} (${user.email || "Unnamed"}): ${user.business_unit_id} -> ${primaryBU.id}`
                                );
                            }
                        }
                    }
                } catch (error: any) {
                    console.error(
                        `✗ Error fixing user ${user.id}:`,
                        error.message
                    );
                }
            }

            console.log(`\n${"-".repeat(80)}`);
            console.log(`Step 3 Summary: ${stats.orphanedCustomersFixed} customers fixed, ${stats.orphanedUsersFixed} users fixed`);
        }

        // Step 4: Update existing business units with null created_by/modified_by
        console.log(
            "\n📋 Step 4: Updating business units with null created_by/modified_by..."
        );
        console.log("-".repeat(80));

        const buWhere: any = {
            OR: [{ created_by: null }, { modified_by: null }],
        };

        if (accountId) {
            buWhere.account_id = accountId;
        }

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
            console.log(
                "No business units found with null created_by/modified_by."
            );
        } else {
            console.log(
                `Found ${existingBUs.length} business unit(s) with null created_by/modified_by.\n`
            );

            for (const bu of existingBUs) {
                try {
                    if (dryRun) {
                        console.log(
                            `[DRY RUN] Would update BU ${bu.id} (${bu.name || "Unnamed"}) - set created_by/modified_by to ${supportUser.id}`
                        );
                        stats.buMetadataUpdated++;
                    } else {
                        await prisma.businessUnit.update({
                            where: { id: bu.id },
                            data: {
                                created_by: bu.created_by || supportUser.id,
                                modified_by: bu.modified_by || supportUser.id,
                            },
                        });

                        stats.buMetadataUpdated++;
                        console.log(
                            `✓ Updated BU ${bu.id} (${bu.name || "Unnamed"}) - set created_by/modified_by to ${supportUser.id}`
                        );
                    }
                } catch (error: any) {
                    console.error(
                        `✗ Error updating BU ${bu.id} (${bu.name || "Unnamed"}):`,
                        error.message
                    );
                }
            }
        }

        console.log(`\n${"-".repeat(80)}`);
        console.log(`Step 4 Summary: ${stats.buMetadataUpdated} updated`);

        // Step 5: Fix circular parent references
        console.log("\n📋 Step 5: Checking for circular parent references...");
        console.log("-".repeat(80));

        const busWithParents = await prisma.businessUnit.findMany({
            where: {
                parent_id: { not: null },
                ...(accountId ? { account_id: accountId } : {}),
            },
            select: {
                id: true,
                name: true,
                parent_id: true,
                account_id: true,
            },
        });

        console.log(
            `Found ${busWithParents.length} business unit(s) with parent assignments to validate.\n`
        );

        for (const bu of busWithParents) {
            if (!bu.parent_id) continue;

            try {
                // Check if parent is self (direct circular reference)
                if (bu.id === bu.parent_id) {
                    // Set to null (no parent)
                    if (dryRun) {
                        console.log(
                            `[DRY RUN] Would fix circular reference: BU ${bu.id} (${bu.name || "Unnamed"}) has itself as parent - would set parent_id to null`
                        );
                        stats.circularReferencesFixed++;
                    } else {
                        await prisma.businessUnit.update({
                            where: { id: bu.id },
                            data: { parent_id: null },
                        });
                        stats.circularReferencesFixed++;
                        console.log(
                            `✓ Fixed circular reference: BU ${bu.id} (${bu.name || "Unnamed"}) - set parent_id to null`
                        );
                    }
                    continue;
                }

                // Check if parent exists and belongs to same account
                const parent = await prisma.businessUnit.findUnique({
                    where: { id: bu.parent_id },
                    select: { id: true, account_id: true },
                });

                if (!parent) {
                    // Parent doesn't exist - set to null
                    if (dryRun) {
                        console.log(
                            `[DRY RUN] Would fix invalid parent reference: BU ${bu.id} (${bu.name || "Unnamed"}) has non-existent parent ${bu.parent_id} - would set parent_id to null`
                        );
                        stats.circularReferencesFixed++;
                    } else {
                        await prisma.businessUnit.update({
                            where: { id: bu.id },
                            data: { parent_id: null },
                        });
                        stats.circularReferencesFixed++;
                        console.log(
                            `✓ Fixed invalid parent reference: BU ${bu.id} (${bu.name || "Unnamed"}) - set parent_id to null`
                        );
                    }
                } else if (parent.account_id !== bu.account_id) {
                    // Parent belongs to different account - set to null
                    if (dryRun) {
                        console.log(
                            `[DRY RUN] Would fix cross-account parent reference: BU ${bu.id} (${bu.name || "Unnamed"}) has parent ${bu.parent_id} from different account - would set parent_id to null`
                        );
                        stats.circularReferencesFixed++;
                    } else {
                        await prisma.businessUnit.update({
                            where: { id: bu.id },
                            data: { parent_id: null },
                        });
                        stats.circularReferencesFixed++;
                        console.log(
                            `✓ Fixed cross-account parent reference: BU ${bu.id} (${bu.name || "Unnamed"}) - set parent_id to null`
                        );
                    }
                }
            } catch (error: any) {
                console.error(`✗ Error checking BU ${bu.id}:`, error.message);
            }
        }

        console.log(`\n${"-".repeat(80)}`);
        console.log(`Step 5 Summary: ${stats.circularReferencesFixed} circular/invalid references fixed`);

        // Step 6: Check for duplicate external_ids within same account
        console.log(
            "\n📋 Step 6: Checking for duplicate external_ids within accounts..."
        );
        console.log("-".repeat(80));

        const busWithExternalIds = await prisma.businessUnit.findMany({
            where: {
                external_id: { not: null },
                ...(accountId ? { account_id: accountId } : {}),
            },
            select: {
                id: true,
                account_id: true,
                external_id: true,
                name: true,
            },
            orderBy: [{ account_id: "asc" }, { external_id: "asc" }],
        });

        // Group by account_id and external_id to find duplicates
        const duplicates = new Map<
            string,
            Array<{ id: number; name: string; external_id: string | null }>
        >();

        for (const bu of busWithExternalIds) {
            if (!bu.external_id) continue;
            const key = `${bu.account_id}:${bu.external_id}`;
            if (!duplicates.has(key)) {
                duplicates.set(key, []);
            }
            duplicates
                .get(key)!
                .push({
                    id: bu.id,
                    name: bu.name,
                    external_id: bu.external_id,
                });
        }

        // Filter to only actual duplicates (more than one BU with same external_id in same account)
        const actualDuplicates = Array.from(duplicates.entries()).filter(
            ([_, bus]) => bus.length > 1
        );

        if (actualDuplicates.length === 0) {
            console.log("No duplicate external_ids found.");
        } else {
            console.log(
                `Found ${actualDuplicates.length} duplicate external_id(s) within accounts.\n`
            );

            for (const [key, bus] of actualDuplicates) {
                const [accountIdStr, externalId] = key.split(":");
                // Keep the first one (lowest ID), clear external_id for others
                const toKeep = bus[0];
                const toFix = bus.slice(1);

                console.log(
                    `Account ${accountIdStr}, external_id "${externalId}": ${bus.length} BUs found`
                );
                console.log(
                    `  Keeping: BU ${toKeep.id} (${toKeep.name || "Unnamed"})`
                );

                for (const bu of toFix) {
                    if (dryRun) {
                        console.log(
                            `  [DRY RUN] Would clear external_id for BU ${bu.id} (${bu.name || "Unnamed"})`
                        );
                        stats.duplicateExternalIdsFixed++;
                    } else {
                        await prisma.businessUnit.update({
                            where: { id: bu.id },
                            data: { external_id: null },
                        });
                        stats.duplicateExternalIdsFixed++;
                        console.log(
                            `  ✓ Cleared external_id for BU ${bu.id} (${bu.name || "Unnamed"})`
                        );
                    }
                }
            }
        }

        console.log(`\n${"-".repeat(80)}`);
        console.log(`Step 6 Summary: ${stats.duplicateExternalIdsFixed} duplicate external_ids fixed`);

        // Final summary
        console.log(`\n${"=".repeat(80)}`);
        console.log("📊 DATABASE UPDATE SUMMARY");
        console.log("=".repeat(80));
        console.log(`Accounts processed: ${stats.accountsProcessed}`);
        console.log(`Primary BUs created: ${stats.primaryBUsCreated}`);
        console.log(
            `Primary BUs skipped (already exist): ${stats.primaryBUsSkipped}`
        );
        console.log(`Users assigned to primary BU: ${stats.usersAssigned}`);
        console.log(`Users failed/errors: ${stats.usersFailed}`);
        if (fixOrphans) {
            console.log(
                `Orphaned customer references fixed: ${stats.orphanedCustomersFixed}`
            );
            console.log(
                `Orphaned user references fixed: ${stats.orphanedUsersFixed}`
            );
        }
        console.log(`BU metadata updated: ${stats.buMetadataUpdated}`);
        console.log(
            `Circular/invalid references fixed: ${stats.circularReferencesFixed}`
        );
        console.log(
            `Duplicate external_ids fixed: ${stats.duplicateExternalIdsFixed}`
        );
        console.log(`Accounts with errors: ${stats.accountsWithErrors}`);
        console.log("=".repeat(80));

        if (dryRun) {
            console.log(
                "\n⚠️  DRY RUN MODE: No changes were made to the database."
            );
            console.log("   Run without --dry-run to apply changes.");
        } else {
            console.log("\n✅ Database update completed successfully!");
        }

        return stats;
    } catch (error: any) {
        console.error("\n❌ Database update failed:", error);
        throw error;
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const accountIdArg = args.find((arg) => arg.startsWith("--account-id="));
const accountId = accountIdArg
    ? parseInt(accountIdArg.split("=")[1], 10)
    : undefined;
const fixOrphans = !args.includes("--no-fix-orphans");

if (accountIdArg && isNaN(accountId!)) {
    console.error(
        "Error: Invalid account-id format. Use --account-id=<number>"
    );
    process.exit(1);
}

// Run update
updateBusinessUnitsData({ dryRun, accountId, fixOrphans })
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
