/**
 * Datafix script to migrate user roles:
 * - Admin -> archaser_admin
 * - Account_Manager -> Collection_Manager
 *
 * This script is idempotent and can be run multiple times safely.
 *
 * Usage:
 *   npx ts-node scripts/migrate-user-roles.ts
 *   npx ts-node scripts/migrate-user-roles.ts --dry-run
 *   npx ts-node scripts/migrate-user-roles.ts --account-id=10013
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface DatafixStats {
    adminUsersMigrated: number;
    adminUsersSkipped: number;
    accountManagerUsersMigrated: number;
    accountManagerUsersSkipped: number;
    usersWithErrors: number;
    accountsProcessed: number;
}

async function migrateUserRoles(options: {
    dryRun?: boolean;
    accountId?: number;
}): Promise<DatafixStats> {
    const { dryRun = false, accountId } = options;

    console.log("=".repeat(80));
    console.log("User Role Migration Datafix Script");
    console.log("=".repeat(80));
    console.log(
        `Mode: ${dryRun ? "DRY RUN (no changes will be made)" : "LIVE (changes will be committed)"}`
    );
    if (accountId) {
        console.log(`Filter: Processing only account ID ${accountId}`);
    }
    console.log("=".repeat(80));

    const stats: DatafixStats = {
        adminUsersMigrated: 0,
        adminUsersSkipped: 0,
        accountManagerUsersMigrated: 0,
        accountManagerUsersSkipped: 0,
        usersWithErrors: 0,
        accountsProcessed: 0,
    };

    try {
        // Step 0: Add new enum values to the database (if not already present)
        console.log("\n📋 Step 0: Adding new enum values to database...");
        console.log("-".repeat(80));
        try {
            // Note: These values match the @map values in the Prisma schema
            await prisma.$executeRaw`ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'ARchaser Admin'`;
            await prisma.$executeRaw`ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'Collection Manager'`;
            await prisma.$executeRaw`ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'System Administrator'`;
            console.log("✓ Added new enum values to database");
        } catch (_error: any) {
            // Enum values might already exist, continue
            console.log("⚠ Enum values may already exist, continuing...");
        }

        // Step 1: Migrate Admin -> archaser_admin using raw SQL
        console.log("\n📋 Step 1: Migrating Admin users to archaser_admin...");
        console.log("-".repeat(80));

        // Use raw SQL to find Admin users since Prisma no longer recognizes "Admin" enum value
        const adminUsers = accountId
            ? await prisma.$queryRaw<any[]>`
                SELECT id, email, name, account_id, role::text as role
                FROM "User"
                WHERE role = 'Admin' AND account_id = ${accountId}
                ORDER BY account_id ASC
            `
            : await prisma.$queryRaw<any[]>`
                SELECT id, email, name, account_id, role::text as role
                FROM "User"
                WHERE role = 'Admin'
                ORDER BY account_id ASC
            `;

        if (adminUsers.length === 0) {
            console.log("No Admin users found to migrate.");
        } else {
            console.log(
                `Found ${adminUsers.length} Admin user(s) to process.\n`
            );

            for (const user of adminUsers) {
                try {
                    if (dryRun) {
                        console.log(
                            `[DRY RUN] Would migrate Admin user: ${user.email || user.name || user.id} (Account: ${user.account_id})`
                        );
                        stats.adminUsersMigrated++;
                    } else {
                        // Use raw SQL to update the role
                        // Note: The Prisma schema maps archaser_admin to "ARchaser Admin" in DB
                        await prisma.$executeRaw`UPDATE "User" SET role = 'ARchaser Admin' WHERE id = ${user.id}`;
                        stats.adminUsersMigrated++;
                        console.log(
                            `✓ Migrated Admin user: ${user.email || user.name || user.id} (Account: ${user.account_id})`
                        );
                    }
                } catch (error: any) {
                    stats.usersWithErrors++;
                    console.error(
                        `✗ Error migrating Admin user ${user.email || user.name || user.id}:`,
                        error.message
                    );
                }
            }
        }

        console.log(`\n${"-".repeat(80)}`);
        console.log(
            `Step 1 Summary: ${stats.adminUsersMigrated} migrated, ${stats.adminUsersSkipped} skipped, ${stats.usersWithErrors} errors`
        );

        // Step 2: Migrate Account_Manager -> Collection_Manager
        console.log(
            "\n📋 Step 2: Migrating Account_Manager users to Collection_Manager..."
        );
        console.log("-".repeat(80));

        // Use raw SQL to find Account_Manager users since Prisma no longer recognizes "Account_Manager" enum value
        // Note: The database stores "Account Manager" (with space) due to @map
        const accountManagerUsers = accountId
            ? await prisma.$queryRaw<any[]>`
                SELECT id, email, name, account_id, role::text as role
                FROM "User"
                WHERE role = 'Account Manager' AND account_id = ${accountId}
                ORDER BY account_id ASC
            `
            : await prisma.$queryRaw<any[]>`
                SELECT id, email, name, account_id, role::text as role
                FROM "User"
                WHERE role = 'Account Manager'
                ORDER BY account_id ASC
            `;

        if (accountManagerUsers.length === 0) {
            console.log("No Account_Manager users found to migrate.");
        } else {
            console.log(
                `Found ${accountManagerUsers.length} Account_Manager user(s) to process.\n`
            );

            for (const user of accountManagerUsers) {
                try {
                    if (dryRun) {
                        console.log(
                            `[DRY RUN] Would migrate Account_Manager user: ${user.email || user.name || user.id} (Account: ${user.account_id})`
                        );
                        stats.accountManagerUsersMigrated++;
                    } else {
                        // Use raw SQL to update the role
                        // Note: The Prisma schema maps Collection_Manager to "Collection Manager" in DB
                        // So we need to use "Collection Manager" (with space) to match the @map
                        await prisma.$executeRaw`UPDATE "User" SET role = 'Collection Manager' WHERE id = ${user.id}`;
                        stats.accountManagerUsersMigrated++;
                        console.log(
                            `✓ Migrated Account_Manager user: ${user.email || user.name || user.id} (Account: ${user.account_id})`
                        );
                    }
                } catch (error: any) {
                    stats.usersWithErrors++;
                    console.error(
                        `✗ Error migrating Account_Manager user ${user.email || user.name || user.id}:`,
                        error.message
                    );
                }
            }
        }

        console.log(`\n${"-".repeat(80)}`);
        console.log(
            `Step 2 Summary: ${stats.accountManagerUsersMigrated} migrated, ${stats.accountManagerUsersSkipped} skipped, ${stats.usersWithErrors} errors`
        );

        // Final summary
        console.log(`\n${"=".repeat(80)}`);
        console.log("Migration Summary");
        console.log("=".repeat(80));
        console.log(
            `Admin -> archaser_admin: ${stats.adminUsersMigrated} migrated`
        );
        console.log(
            `Account_Manager -> Collection_Manager: ${stats.accountManagerUsersMigrated} migrated`
        );
        console.log(`Total errors: ${stats.usersWithErrors}`);
        console.log("=".repeat(80));

        return stats;
    } catch (error: any) {
        console.error("\n❌ Fatal error during migration:", error.message);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const accountIdArg = args.find((arg) => arg.startsWith("--account-id="));
const accountId = accountIdArg
    ? parseInt(accountIdArg.split("=")[1], 10)
    : undefined;

if (accountIdArg && isNaN(accountId!)) {
    console.error("❌ Error: Invalid account-id parameter");
    process.exit(1);
}

// Run the migration
migrateUserRoles({ dryRun, accountId })
    .then(() => {
        console.log("\n✅ Migration completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n❌ Migration failed:", error);
        process.exit(1);
    });
